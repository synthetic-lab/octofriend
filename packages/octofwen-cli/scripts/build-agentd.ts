#!/usr/bin/env bun
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "bun";

const profileIndex = process.argv.indexOf("--profile");
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : "release";
if (profile !== "debug" && profile !== "release") {
	throw new Error(`Unsupported octofwen-agentd build profile: ${profile}`);
}

const repoRoot = resolve(import.meta.dirname, "../../..");
const manifestPath = resolve(repoRoot, "crates/octofwen-agent/Cargo.toml");
const cargoArgs = [
	"build",
	"--manifest-path",
	manifestPath,
	"--bin",
	"octofwen-agentd",
];
if (profile === "release") cargoArgs.push("--release");

const cargo = spawn(["cargo", ...cargoArgs], {
	stdin: "ignore",
	stdout: "inherit",
	stderr: "inherit",
});
const exitCode = await cargo.exited;
if (exitCode !== 0) process.exit(exitCode);

const executableName =
	process.platform === "win32" ? "octofwen-agentd.exe" : "octofwen-agentd";
const targetProfile = profile === "release" ? "release" : "debug";
const builtExecutable = resolve(
	repoRoot,
	"target",
	targetProfile,
	executableName,
);
const packagedExecutable = resolve(
	repoRoot,
	"packages/octofwen-cli/bin",
	executableName,
);

await mkdir(dirname(packagedExecutable), { recursive: true });
await copyFile(builtExecutable, packagedExecutable);
if (process.platform !== "win32") {
	await chmod(packagedExecutable, 0o755);
}
console.log(`packaged ${packagedExecutable}`);
