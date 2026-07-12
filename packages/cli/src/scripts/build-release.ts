#!/usr/bin/env bun
import { chmod, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "bun";

type Arguments = {
	targetId: string;
	bunTarget: string;
	version: string;
};

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function parseArgs(argv: string[]): Arguments {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!(key?.startsWith("--") && value)) {
			throw new Error(
				"Usage: build-release --target-id <id> --bun-target <target> --version <version>",
			);
		}
		values.set(key.slice(2), value);
	}
	const targetId = values.get("target-id");
	const bunTarget = values.get("bun-target");
	const version = values.get("version");
	if (!(targetId && bunTarget && version))
		throw new Error("Missing release build argument");
	if (!VERSION_PATTERN.test(version)) {
		throw new Error(`Invalid release version: ${version}`);
	}
	return { targetId, bunTarget, version };
}

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

const args = parseArgs(process.argv.slice(2));
const root = resolve(import.meta.dirname, "../../../..");
const archiveName = `octofriend-${args.version}-${args.targetId}`;
const stage = resolve(root, "dist/release", archiveName);
const windows = args.targetId.startsWith("windows-");
const extension = windows ? ".exe" : "";
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

await run([
	"cargo",
	"build",
	"--release",
	"--manifest-path",
	resolve(root, "crates/octofriend-agent/Cargo.toml"),
	"--bin",
	"octofriend-agentd",
]);

const define = {
	__OCTO_VERSION__: JSON.stringify(args.version),
	"process.env.NODE_ENV": JSON.stringify("production"),
};
for (const [entrypoint, output] of [
	["packages/cli/src/bin.ts", `octofriend${extension}`],
	["packages/cli/src/acp/index.ts", `octofriend-acp${extension}`],
] as const) {
	const result = await Bun.build({
		entrypoints: [resolve(root, entrypoint)],
		compile: {
			target: args.bunTarget as never,
			outfile: resolve(stage, output),
			autoloadDotenv: false,
			autoloadBunfig: false,
		},
		define,
		minify: true,
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error(`Failed to compile ${entrypoint}`);
	}
}

const daemon = `octofriend-agentd${extension}`;
await copyFile(resolve(root, "target/release", daemon), resolve(stage, daemon));
await copyFile(resolve(root, "LICENSE"), resolve(stage, "LICENSE"));
await writeFile(resolve(stage, "VERSION"), `${args.version}\n`);
if (!windows) {
	for (const name of ["octofriend", "octofriend-acp", "octofriend-agentd"]) {
		await chmod(resolve(stage, name), 0o755);
	}
}
console.log(
	JSON.stringify({
		archiveName,
		stage,
		files: [`octofriend${extension}`, `octofriend-acp${extension}`, daemon],
	}),
);
