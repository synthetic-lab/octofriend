#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const executable = join(
	binDir,
	process.platform === "win32" ? "octofwen-agentd.exe" : "octofwen-agentd",
);

const child = Bun.spawn([executable, ...process.argv.slice(2)], {
	stdin: "inherit",
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await child.exited;
process.exit(exitCode);
