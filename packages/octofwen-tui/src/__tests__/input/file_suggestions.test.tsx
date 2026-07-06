import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { SuggestionList, searchFiles } from "../../input/file_suggestions.tsx";
import type { Transport } from "../../internal/transport/common.ts";
import { LocalTransport } from "../../internal/transport/local.ts";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function createSearchFixture(): Promise<Transport> {
	const root = await mkdtemp(join(tmpdir(), "octofwen-file-suggestions-"));
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

describe("searchFiles", () => {
	it("returns short matching file paths while honoring gitignore", async () => {
		const matches = await searchFiles(
			"src",
			await createSearchFixture(),
			new AbortController().signal,
		);

		expect(matches).toEqual(["src/app.ts", "src/components/input.tsx"]);
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
});
