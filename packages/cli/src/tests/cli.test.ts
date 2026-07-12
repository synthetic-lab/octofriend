import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { createoctofriendCommand } from "@octofriend/cli";

function runCliCommand(...args: string[]) {
	return Bun.spawnSync({
		cmd: [process.execPath, "packages/cli/src/bin.ts", ...args],
		stdout: "pipe",
		stderr: "pipe",
	});
}

function successfulHelpOutput(args: string[]): string {
	const result = runCliCommand(...args, "--help");
	if (result.exitCode !== 0) {
		throw new Error(
			result.stderr.toString() ||
				`Expected exit code 0, got ${result.exitCode}`,
		);
	}
	return result.stdout.toString();
}

function expectSuccessfulHelp(args: string[], expectedSnippets: string[]) {
	const output = successfulHelpOutput(args);
	for (const snippet of expectedSnippets) {
		if (!output.includes(snippet)) {
			throw new Error(`Expected help output to contain ${snippet}`);
		}
	}
}

describe("cli", () => {
	it("exports the command factory", () => {
		expect(createoctofriendCommand).toBeFunction();
	});

	it("preserves legacy and renamed npm bins", () => {
		const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

		expect(packageJson.bin).toEqual({
			octofriend: "packages/cli/bin/octofriend.js",
			octo: "packages/cli/bin/octofriend.js",
			"octofriend-acp": "packages/cli/bin/octofriend-acp.js",
			"octofriend-agentd": "packages/cli/bin/octofriend-agentd.js",
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
				"--prefill <prompt>",
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
