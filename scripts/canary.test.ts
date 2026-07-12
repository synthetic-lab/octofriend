import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const entrypoint = "packages/cli/src/bin.ts";

describe("canary launchers", () => {
	test.each([
		"canary.ps1",
		"canary.sh",
		"canary.fish",
	])("%s launches the rewrite CLI entrypoint", async (launcher) => {
		const source = await readFile(resolve(repositoryRoot, launcher), "utf8");

		expect(source).toContain(entrypoint);
		expect(source).not.toContain("packages/octofriend-cli/");
	});

	test("the referenced entrypoint exists", async () => {
		expect(await Bun.file(resolve(repositoryRoot, entrypoint)).exists()).toBe(
			true,
		);
	});
});
