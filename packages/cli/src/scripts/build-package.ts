#!/usr/bin/env bun
import { chmod, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "bun";

async function run(command: string[]): Promise<void> {
	const child = spawn(command, {
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	const status = await child.exited;
	if (status !== 0)
		throw new Error(`${command.join(" ")} exited with ${status}`);
}

const root = resolve(import.meta.dirname, "../../../..");
const bin = resolve(root, "packages/cli/bin");
const packageJson = JSON.parse(
	await readFile(resolve(root, "package.json"), "utf8"),
) as { version?: unknown };
const version =
	typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

await run([
	process.execPath,
	resolve(root, "packages/cli/src/scripts/build-agentd.ts"),
]);
await mkdir(bin, { recursive: true });

for (const [entrypoint, output] of [
	["packages/cli/src/bin.ts", "octofriend.js"],
	["packages/cli/src/acp/index.ts", "octofriend-acp.js"],
] as const) {
	const result = await Bun.build({
		entrypoints: [resolve(root, entrypoint)],
		outdir: bin,
		naming: output,
		target: "bun",
		minify: true,
		define: {
			__OCTO_VERSION__: JSON.stringify(version),
			"process.env.NODE_ENV": JSON.stringify("production"),
		},
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error(`Failed to bundle ${entrypoint}`);
	}
	if (process.platform !== "win32") await chmod(resolve(bin, output), 0o755);
}

console.log(`packaged Bun entrypoints in ${bin}`);
