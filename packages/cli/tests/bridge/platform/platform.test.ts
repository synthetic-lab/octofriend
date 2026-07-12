import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	PACKAGED_AGENTD_EXECUTABLE_PATH,
	resolveAgentdCommand,
	resolveAgentdExecutable,
	spawnAgentdProcess,
} from "../../../src/bridge/platform/platform.ts";

describe("resolveAgentdExecutable", () => {
	it("uses an explicitly configured executable before environment values", () => {
		expect(
			resolveAgentdExecutable({
				executable: "/tmp/configured-agentd",
				env: { octofriend_AGENTD: "/tmp/env-agentd" },
			}),
		).toBe("/tmp/configured-agentd");
	});

	it("uses octofriend_AGENTD from the provided environment", () => {
		expect(
			resolveAgentdExecutable({
				env: { octofriend_AGENTD: "/tmp/env-agentd" },
			}),
		).toBe("/tmp/env-agentd");
	});

	it("falls back to the packaged agent daemon launcher", () => {
		expect(resolveAgentdExecutable({ env: {} })).toBe(
			PACKAGED_AGENTD_EXECUTABLE_PATH,
		);
	});
});

describe("resolveAgentdCommand", () => {
	it("runs configured executables directly", () => {
		expect(
			resolveAgentdCommand({ env: { octofriend_AGENTD: "/tmp/env-agentd" } }),
		).toEqual(["/tmp/env-agentd"]);
	});

	it("runs the packaged launcher through the current Bun executable", () => {
		expect(resolveAgentdCommand({ env: {} })).toEqual([
			process.execPath,
			PACKAGED_AGENTD_EXECUTABLE_PATH,
		]);
	});

	it("runs an adjacent launcher from a bundled npm entrypoint", () => {
		expect(
			resolveAgentdCommand({
				env: {},
				processExecutable: "/usr/bin/bun",
				scriptPath: "/opt/octofriend/packages/cli/bin/octofriend.js",
			}),
		).toEqual([
			"/usr/bin/bun",
			join(
				dirname("/opt/octofriend/packages/cli/bin/octofriend.js"),
				"octofriend-agentd.js",
			),
		]);
	});

	it("runs an adjacent native daemon from a standalone executable", () => {
		expect(
			resolveAgentdCommand({
				env: {},
				processExecutable: "/opt/octofriend/octofriend",
			}),
		).toEqual([
			join(
				dirname("/opt/octofriend/octofriend"),
				process.platform === "win32"
					? "octofriend-agentd.exe"
					: "octofriend-agentd",
			),
		]);
	});
});

describe("spawnAgentdProcess", () => {
	it("spawns the configured executable with piped stdio", () => {
		const calls: unknown[][] = [];
		const stdout = new ReadableStream<Uint8Array>();
		const stderr = new ReadableStream<Uint8Array>();

		const process = spawnAgentdProcess({
			executable: "/tmp/octofriend-agentd",
			spawn(command, options) {
				calls.push([command, options]);
				return {
					stdin: {
						write() {
							return 0;
						},
					},
					stdout,
					stderr,
					kill() {
						return;
					},
				};
			},
		});

		expect(calls).toEqual([
			[
				["/tmp/octofriend-agentd"],
				{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
			],
		]);
		expect(process.stdout).toBe(stdout);
		expect(process.stderr).toBe(stderr);
	});

	it("wraps Bun file sink stdin as a writable stream", async () => {
		const chunks: string[] = [];
		let flushed = false;
		let ended = false;

		const process = spawnAgentdProcess({
			executable: "/tmp/octofriend-agentd",
			spawn() {
				return {
					stdin: {
						write(chunk: Uint8Array) {
							chunks.push(new TextDecoder().decode(chunk));
							return chunk.byteLength;
						},
						flush() {
							flushed = true;
						},
						end() {
							ended = true;
						},
					},
					stdout: new ReadableStream<Uint8Array>(),
					stderr: new ReadableStream<Uint8Array>(),
					kill() {
						return;
					},
				};
			},
		});

		const writer = process.stdin.getWriter();
		await writer.write(new TextEncoder().encode("hello"));
		await writer.close();

		expect(chunks).toEqual(["hello"]);
		expect(flushed).toBe(true);
		expect(ended).toBe(true);
	});
});

describe("packaged agent daemon startup", () => {
	it("keeps the workspace CLI package publishable and includes the agent daemon launcher", () => {
		const packageJson = JSON.parse(
			readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
		) as {
			private?: boolean;
			bin?: Record<string, string>;
			files?: string[];
		};

		expect(packageJson.private).toBeUndefined();
		expect(packageJson.bin).toMatchObject({
			octofriend: "./bin/octofriend.js",
			octo: "./bin/octofriend.js",
			"octofriend-agentd": "./bin/octofriend-agentd.js",
		});
		expect(packageJson.files).toContain("bin");

		const launcher = readFileSync(
			new URL("../../../bin/octofriend-agentd.js", import.meta.url),
			"utf8",
		);
		expect(launcher.startsWith("#!/usr/bin/env bun\n")).toBe(true);
	});
});
