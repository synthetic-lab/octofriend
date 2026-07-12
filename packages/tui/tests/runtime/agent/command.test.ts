import { describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import {
	PACKAGED_AGENTD_LAUNCHER_PATH,
	resolveAgentdCommand,
} from "../../../src/runtime/agent/command.ts";

describe("resolveAgentdCommand", () => {
	it("runs configured executables directly", () => {
		expect(
			resolveAgentdCommand({ octofriend_AGENTD: "/tmp/env-agentd" }),
		).toEqual(["/tmp/env-agentd"]);
	});

	it("runs the packaged launcher through the current Bun executable", () => {
		expect(resolveAgentdCommand({})).toEqual([
			process.execPath,
			PACKAGED_AGENTD_LAUNCHER_PATH,
		]);
	});

	it("resolves bundled and standalone adjacent daemons", () => {
		expect(
			resolveAgentdCommand(
				{},
				{
					processExecutable: "/usr/bin/bun",
					scriptPath: "/opt/octofriend/packages/cli/bin/octofriend-acp.js",
				},
			),
		).toEqual([
			"/usr/bin/bun",
			join(
				dirname("/opt/octofriend/packages/cli/bin/octofriend-acp.js"),
				"octofriend-agentd.js",
			),
		]);
		expect(
			resolveAgentdCommand(
				{},
				{ processExecutable: "/opt/octofriend/octofriend" },
			),
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
