import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createOctofwenCommand } from "@octofwen/octofwen-cli";

function runCliCommand(...args: string[]) {
	return Bun.spawnSync({
		cmd: [process.execPath, "packages/octofwen-cli/src/bin.ts", ...args],
		stdout: "pipe",
		stderr: "pipe",
	});
}

function expectSuccessfulHelp(args: string[], expectedSnippets: string[]) {
	const result = runCliCommand(...args, "--help");

	expect(result.exitCode).toBe(0);
	const output = result.stdout.toString();
	for (const snippet of expectedSnippets) {
		expect(output).toContain(snippet);
	}
}

describe("cli", () => {
	it("exports the command factory", () => {
		expect(createOctofwenCommand).toBeFunction();
	});

	it("preserves legacy and renamed npm bins", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

		expect(packageJson.bin).toEqual({
			octofriend: "packages/octofwen-cli/src/bin.ts",
			octofwen: "packages/octofwen-cli/src/bin.ts",
			octo: "packages/octofwen-cli/src/bin.ts",
			"octofwen-agentd": "packages/octofwen-cli/bin/octofwen-agentd.js",
		});
		expect(packageJson.bundledDependencies).toBeUndefined();
	});

	it("prints the root package version like the legacy CLI", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
		const result = runCliCommand("version");

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe(`${packageJson.version}\n`);
	});

	it("prints the root changelog like the legacy CLI", () => {
		const changelog = readFileSync("CHANGELOG.md", "utf8");
		const result = runCliCommand("changelog");

		expect(result.exitCode).toBe(0);
		expect(result.stdout.toString()).toBe(`${changelog}\n`);
	});

	it("preserves the legacy root command surface", () => {
		expectSuccessfulHelp(
			[],
			[
				"If run with no subcommands, runs Octo interactively.",
				"--config <path>",
				"--unchained",
				"docker",
				"version",
				"init",
				"changelog",
				"list",
				"bench",
				"prompt [options] <prompt>",
			],
		);
	});

	it("preserves the legacy docker command surface", () => {
		expectSuccessfulHelp(
			["docker"],
			[
				"Sandbox Octo inside Docker",
				"connect [options] <target>",
				"Sandbox Octo inside an already-running container",
				"run [options] [args...]",
				"Run a Docker image and sandbox Octo inside it",
			],
		);
		expectSuccessfulHelp(
			["docker", "connect"],
			[
				"Sandbox Octo inside an already-running container",
				"target",
				"The Docker container",
				"--config <path>",
				"--unchained",
			],
		);
		expectSuccessfulHelp(
			["docker", "run"],
			[
				"Run a Docker image and sandbox Octo inside it",
				"args",
				"The args to pass to `docker run`",
				"--config <path>",
				"--unchained",
			],
		);
	});

	it("preserves the legacy bench command surface", () => {
		expectSuccessfulHelp(
			["bench"],
			["tps [options]", "Benchmark tokens/sec from your API provider"],
		);
		expectSuccessfulHelp(
			["bench", "tps"],
			[
				"Benchmark tokens/sec from your API provider",
				"--model <model-nickname>",
				"--prompt <prompt>",
				"--concurrency <n>",
			],
		);
	});

	it("preserves the legacy prompt command surface", () => {
		expectSuccessfulHelp(
			["prompt"],
			[
				"Sends a prompt to a model",
				"prompt",
				"The prompt you want to send to this model",
				"--system <prompt>",
				"--model <model-nickname>",
			],
		);
	});
});
