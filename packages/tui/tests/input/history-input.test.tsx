import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import React from "react";
import { InputWithHistory } from "../../src/input/editor/history-input.tsx";
import type { Transport } from "../../src/runtime/workspace/common.ts";
import { LocalTransport } from "../../src/runtime/workspace/local.ts";
import type { InputHistory } from "../../src/shell/input.ts";

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
}

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createFileMentionFixture(): Promise<Transport> {
	const root = await mkdtemp(join(tmpdir(), "octofriend-input-history-"));
	tempRoots.push(root);
	await mkdir(join(root, "src"), { recursive: true });
	await writeFile(join(root, "src/app.ts"), "export {};\n");
	return new LocalTransport(root);
}

const transport: Transport = {
	cwd: "/repo",
	writeFile: async () => undefined,
	readFile: async () => "",
	pathExists: async () => true,
	isDirectory: async () => false,
	mkdir: async () => undefined,
	readdir: async () => [],
	modTime: async () => 0,
	resolvePath: async (_signal, filePath) => filePath,
	shell: async () => "",
	close: async () => undefined,
};

function history(items: string[]): InputHistory {
	return {
		getCurrentHistory: () => items,
		appendToInputHistory: () => Promise.resolve(),
		close: () => undefined,
	};
}

describe("InputWithHistory", () => {
	it("uses the latest change callback for history navigation after rerender", async () => {
		const calls: string[] = [];
		const inputHistory = history(["older prompt"]);
		const instance = render(
			<InputWithHistory
				attachedImages={[]}
				inputHistory={inputHistory}
				transport={transport}
				value=""
				onChange={(value) => calls.push(`first:${value}`)}
				onSubmit={() => undefined}
			/>,
		);

		instance.rerender(
			<InputWithHistory
				attachedImages={[]}
				inputHistory={inputHistory}
				transport={transport}
				value=""
				onChange={(value) => calls.push(`second:${value}`)}
				onSubmit={() => undefined}
			/>,
		);
		instance.stdin.write("\x1b[A");
		await waitFor(() => calls.length > 0);

		expect(calls).toEqual(["second:older prompt"]);
		instance.unmount();
	});
	it("uses the latest submit callback after rerender", async () => {
		const calls: string[] = [];
		const inputHistory = history([]);
		const instance = render(
			<InputWithHistory
				attachedImages={[]}
				inputHistory={inputHistory}
				transport={transport}
				value="hello"
				onChange={() => undefined}
				onSubmit={(value) => {
					calls.push(`first:${value ?? ""}`);
				}}
			/>,
		);

		instance.rerender(
			<InputWithHistory
				attachedImages={[]}
				inputHistory={inputHistory}
				transport={transport}
				value="hello"
				onChange={() => undefined}
				onSubmit={(value) => {
					calls.push(`second:${value ?? ""}`);
				}}
			/>,
		);
		instance.stdin.write("\r");
		await waitFor(() => calls.length > 0);

		expect(calls).toEqual(["second:hello"]);
		instance.unmount();
	});
	it("does not rerender for history navigation when history is empty", async () => {
		let updateCommits = 0;
		const inputHistory = history([]);
		const instance = render(
			<React.Profiler
				id="input-with-history"
				onRender={(_id, phase) => {
					if (phase === "update") updateCommits += 1;
				}}
			>
				<InputWithHistory
					attachedImages={[]}
					inputHistory={inputHistory}
					transport={transport}
					value="draft"
					onChange={() => {
						throw new Error("empty history should not change input");
					}}
					onSubmit={() => undefined}
				/>
			</React.Profiler>,
		);
		await Bun.sleep(1);
		updateCommits = 0;

		instance.stdin.write("\x1b[A");
		await Bun.sleep(1);

		expect(updateCommits).toBe(0);
		instance.unmount();
	});
	it("does not rewrite a manually retyped mention after the selected mention was deleted", async () => {
		const inputHistory = history([]);
		const selectedTransport = await createFileMentionFixture();
		const submitted: string[] = [];
		let latestValue = "";
		function Probe() {
			const [value, setValue] = React.useState("");
			latestValue = value;
			return (
				<InputWithHistory
					attachedImages={[]}
					inputHistory={inputHistory}
					transport={selectedTransport}
					value={value}
					onChange={(nextValue) => {
						latestValue = nextValue;
						setValue(nextValue);
					}}
					onSubmit={(value) => {
						submitted.push(value ?? "");
					}}
				/>
			);
		}

		const instance = render(<Probe />);
		instance.stdin.write("@src");
		await waitFor(() => (instance.lastFrame() ?? "").includes("src/app.ts"));
		instance.stdin.write("\r");
		await waitFor(() => latestValue === "@src/app.ts ");
		instance.stdin.write("\x15");
		await waitFor(() => latestValue === "");
		instance.stdin.write("@src/app.ts");
		await waitFor(() => latestValue === "@src/app.ts");
		instance.stdin.write("\x1b");
		await waitFor(() => !(instance.lastFrame() ?? "").includes("src/app.ts"));
		instance.stdin.write("\r");
		await waitFor(() => submitted.length === 1);

		expect(submitted).toEqual(["@src/app.ts"]);
		instance.unmount();
	});
});
