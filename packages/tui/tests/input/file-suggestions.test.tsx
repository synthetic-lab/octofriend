import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import stringWidth from "string-width";
import {
	FileSuggestionBox,
	SuggestionList,
	searchFiles,
	stableFileResults,
	useFileSearch,
} from "../../src/input/file-suggestions.tsx";
import type { Transport } from "../../src/runtime/workspace/common.ts";
import { LocalTransport } from "../../src/runtime/workspace/local.ts";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createSearchFixture(): Promise<Transport> {
	const root = await mkdtemp(join(tmpdir(), "octofriend-file-suggestions-"));
	tempRoots.push(root);
	await mkdir(join(root, "src/components"), { recursive: true });
	await mkdir(join(root, "ignored"), { recursive: true });
	await writeFile(join(root, ".gitignore"), "ignored/**\n");
	await writeFile(join(root, "src/app.ts"), "export {};\n");
	await writeFile(join(root, "src/components/input.tsx"), "export {};\n");
	await writeFile(join(root, "ignored/secret.ts"), "export {};\n");
	await writeFile(join(root, "README.md"), "# fixture\n");
	return new LocalTransport(root);
}

function FileSearchProbe({ transport }: { transport: Transport }) {
	const { selectedIndex } = useFileSearch("missing", {
		transport,
		onSelect: () => undefined,
		debounceMs: 10_000,
	});
	return <Text>{selectedIndex}</Text>;
}

function DisabledFileSearchProbe({ transport }: { transport: Transport }) {
	const { results } = useFileSearch("src", {
		transport,
		onSelect: () => undefined,
		debounceMs: 0,
		enabled: false,
	});
	return <Text>{results.length}</Text>;
}

function remoteSearchTransport(
	cwd: string,
	container: string,
	files: string[],
): Transport {
	return {
		cwd,
		toolRunTransport: () => ({ type: "docker", container }),
		writeFile: async () => undefined,
		readFile: () => Promise.reject(new Error("no gitignore")),
		pathExists: async () => true,
		isDirectory: async () => false,
		mkdir: async () => undefined,
		readdir: async () => [],
		modTime: async () => 0,
		resolvePath: async (_signal, filePath) => filePath,
		shell: async () => files.map((file) => `./${file}`).join("\n"),
		close: async () => undefined,
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error("Timed out waiting for condition");
}

describe("searchFiles", () => {
	it("reuses equal file suggestion arrays to avoid no-op render churn", () => {
		const previous = ["src/app.ts", "src/components/input.tsx"];
		expect(stableFileResults(previous, [...previous])).toBe(previous);
		expect(stableFileResults(previous, [])).toBeArrayOfSize(0);
		expect(stableFileResults([], [])).toBeArrayOfSize(0);
		expect(stableFileResults(previous, ["src/app.ts"])).toEqual(["src/app.ts"]);
	});

	it("returns short matching file paths while honoring gitignore", async () => {
		const matches = await searchFiles(
			"SRC",
			await createSearchFixture(),
			new AbortController().signal,
		);

		expect(matches).toEqual(["src/app.ts", "src/components/input.tsx"]);
	});

	it("keeps file caches separate for remote transports with the same cwd", async () => {
		const first = remoteSearchTransport("/workspace", "first", ["first.ts"]);
		const second = remoteSearchTransport("/workspace", "second", ["second.ts"]);
		const signal = new AbortController().signal;

		expect(await searchFiles("first", first, signal)).toEqual(["first.ts"]);
		expect(await searchFiles("second", second, signal)).toEqual(["second.ts"]);
	});

	it("does not reuse an aborted pending file list for the next query", async () => {
		const root = await mkdtemp(join(tmpdir(), "octofriend-file-suggestions-"));
		tempRoots.push(root);
		let shellCalls = 0;
		const transport: Transport = {
			cwd: root,
			toolRunTransport: () => ({ type: "docker", container: "pending-test" }),
			writeFile: async () => undefined,
			readFile: () => Promise.reject(new Error("no gitignore")),
			pathExists: async () => true,
			isDirectory: async () => false,
			mkdir: async () => undefined,
			readdir: async () => [],
			modTime: async () => 0,
			resolvePath: async (_signal, filePath) => filePath,
			shell: async (signal) => {
				shellCalls += 1;
				await Bun.sleep(5);
				if (signal.aborted) {
					throw new DOMException("Aborted", "AbortError");
				}
				return "./src/live.ts\n";
			},
			close: async () => undefined,
		};

		const first = new AbortController();
		const firstSearch = searchFiles("src", transport, first.signal);
		first.abort();
		await expect(firstSearch).rejects.toThrow();

		const second = new AbortController();
		await expect(searchFiles("src", transport, second.signal)).resolves.toEqual(
			["src/live.ts"],
		);
		expect(shellCalls).toBe(2);
	});

	it("matches non-ASCII file paths case-insensitively", async () => {
		const root = await mkdtemp(join(tmpdir(), "octofriend-file-suggestions-"));
		tempRoots.push(root);
		await writeFile(join(root, "CaféMenu.ts"), "export {};\n");

		const matches = await searchFiles(
			"cafémenu",
			new LocalTransport(root),
			new AbortController().signal,
		);

		expect(matches).toEqual(["CaféMenu.ts"]);
	});

	it("caps matches without resorting the cached file list on every query", async () => {
		const root = await mkdtemp(join(tmpdir(), "octofriend-file-suggestions-"));
		tempRoots.push(root);
		for (let index = 0; index < 12; index += 1) {
			await writeFile(join(root, `file-${index}.ts`), "export {};\n");
		}

		const matches = await searchFiles(
			"file",
			new LocalTransport(root),
			new AbortController().signal,
		);

		expect(matches).toHaveLength(8);
		expect(matches).toEqual([
			"file-0.ts",
			"file-1.ts",
			"file-2.ts",
			"file-3.ts",
			"file-4.ts",
			"file-5.ts",
			"file-6.ts",
			"file-7.ts",
		]);
	});
});

describe("SuggestionList", () => {
	it("renders selected and truncated file suggestions", () => {
		const longPath = `src/${"nested/".repeat(8)}component.tsx`;
		const { lastFrame } = render(
			<SuggestionList items={["src/app.ts", longPath]} selectedIndex={1} />,
		);

		const output = lastFrame() || "";
		expect(output).toContain("src/app.ts");
		expect(output).toContain("> ...");
		expect(output).toContain("component.tsx");
	});

	it("truncates suggestions by terminal width without splitting emoji", () => {
		const longPath = `${"界/".repeat(30)}🚀component.tsx`;
		const { lastFrame } = render(
			<SuggestionList items={[longPath]} selectedIndex={0} />,
		);

		const selectedLine = lastFrame() || "";
		expect(selectedLine).toContain("> ...");
		expect(selectedLine).toContain("🚀component.tsx");
		expect(selectedLine).not.toContain("�");
		expect(stringWidth(selectedLine)).toBeLessThanOrEqual(52);
	});

	it("normalizes CR line breaks in rendered suggestion paths", () => {
		const { lastFrame } = render(
			<SuggestionList
				items={["src/first\r\nsecond\rthird.ts"]}
				selectedIndex={0}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("src/first");
		expect(output).toContain("second");
		expect(output).toContain("third.ts");
		expect(output).not.toContain("\r");
	});
});

describe("FileSuggestionBox", () => {
	it("uses the latest select callback after rerender", async () => {
		const transport = await createSearchFixture();
		const selected: string[] = [];
		const instance = render(
			<FileSuggestionBox
				isVisible={true}
				onDismiss={() => undefined}
				onSelect={(filename) => selected.push(`first:${filename}`)}
				query="src"
				transport={transport}
			/>,
		);

		await waitFor(() => (instance.lastFrame() ?? "").includes("src/app.ts"));

		instance.rerender(
			<FileSuggestionBox
				isVisible={true}
				onDismiss={() => undefined}
				onSelect={(filename) => selected.push(`second:${filename}`)}
				query="src"
				transport={transport}
			/>,
		);
		instance.stdin.write("\r");
		await Bun.sleep(0);

		expect(selected).toEqual(["second:src/app.ts"]);
	});

	it("uses the latest dismiss callback after rerender", async () => {
		const transport = await createSearchFixture();
		const dismisses: string[] = [];
		const instance = render(
			<FileSuggestionBox
				isVisible={true}
				onDismiss={() => dismisses.push("first")}
				onSelect={() => undefined}
				query="src"
				transport={transport}
			/>,
		);

		instance.rerender(
			<FileSuggestionBox
				isVisible={true}
				onDismiss={() => dismisses.push("second")}
				onSelect={() => undefined}
				query="src"
				transport={transport}
			/>,
		);
		instance.stdin.write("\x1b");
		await Bun.sleep(50);

		expect(dismisses).toEqual(["second"]);
	});

	it("does not select stale results while hidden", async () => {
		const transport = await createSearchFixture();
		const selected: string[] = [];
		const instance = render(
			<FileSuggestionBox
				isVisible={true}
				onDismiss={() => undefined}
				onSelect={(filename) => selected.push(filename)}
				query="src"
				transport={transport}
			/>,
		);

		await waitFor(() => (instance.lastFrame() ?? "").includes("src/app.ts"));
		instance.rerender(
			<FileSuggestionBox
				isVisible={false}
				onDismiss={() => undefined}
				onSelect={(filename) => selected.push(filename)}
				query="src"
				transport={transport}
			/>,
		);
		instance.stdin.write("\r");
		await Bun.sleep(0);

		expect(selected).toEqual([]);
	});
});

describe("useFileSearch", () => {
	it("does not search while disabled", async () => {
		let readCalls = 0;
		const baseTransport = await createSearchFixture();
		const transport = Object.create(baseTransport) as Transport;
		transport.readFile = (...args: Parameters<Transport["readFile"]>) => {
			readCalls += 1;
			return baseTransport.readFile(...args);
		};
		render(<DisabledFileSearchProbe transport={transport} />);

		await Bun.sleep(20);

		expect(readCalls).toBe(0);
	});

	it("keeps disabled empty results stable without extra updates", async () => {
		const transport = await createSearchFixture();
		let updateCommits = 0;
		function Probe() {
			const { results } = useFileSearch("src", {
				transport,
				onSelect: () => undefined,
				debounceMs: 0,
				enabled: false,
			});
			return <Text>{results.length}</Text>;
		}
		render(
			<React.Profiler
				id="file-search"
				onRender={(_id, phase) => {
					if (phase === "update") updateCommits += 1;
				}}
			>
				<Probe />
			</React.Profiler>,
		);

		await Bun.sleep(20);

		expect(updateCommits).toBe(0);
	});

	it("keeps selection index non-negative when navigating an empty result list", async () => {
		const root = await mkdtemp(join(tmpdir(), "octofriend-file-suggestions-"));
		tempRoots.push(root);
		const instance = render(
			<FileSearchProbe transport={new LocalTransport(root)} />,
		);

		instance.stdin.write("\t");
		await Bun.sleep(0);

		expect(instance.lastFrame()).toBe("0");
	});
});
