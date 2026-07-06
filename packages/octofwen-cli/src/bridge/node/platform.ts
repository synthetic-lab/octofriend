import { resolve } from "node:path";
import type { AgentdProcessLike } from "../process/client.ts";

export type AgentdExecutableResolutionOptions = {
	executable?: string;
	env?: Record<string, string | undefined>;
};

export const PACKAGED_AGENTD_EXECUTABLE_PATH = resolve(
	import.meta.dirname,
	"../../../bin/octofwen-agentd.js",
);

export type AgentdSpawnOptions = {
	executable?: string;
	spawn?: AgentdSpawnFunction;
};

export type AgentdSpawnFunction = (
	command: string[],
	options: { stdin: "pipe"; stdout: "pipe"; stderr: "pipe" },
) => BunPipeProcess;

export type BunPipeProcess = {
	stdin: {
		write: (chunk: Uint8Array) => number | Promise<number>;
		flush?: () => void | Promise<void>;
		end?: () => void | Promise<void>;
		close?: () => void | Promise<void>;
	};
	stdout: ReadableStream<Uint8Array>;
	stderr: ReadableStream<Uint8Array>;
	kill: () => void;
};

export function resolveAgentdExecutable(
	options: AgentdExecutableResolutionOptions = {},
): string {
	return (
		options.executable ??
		(options.env ?? process.env)["OCTOFWEN_AGENTD"] ??
		PACKAGED_AGENTD_EXECUTABLE_PATH
	);
}

export function resolveAgentdCommand(
	options: AgentdExecutableResolutionOptions = {},
): string[] {
	const executable =
		options.executable ?? (options.env ?? process.env)["OCTOFWEN_AGENTD"];
	return executable
		? [executable]
		: [process.execPath, PACKAGED_AGENTD_EXECUTABLE_PATH];
}

export function spawnAgentdProcess(
	options: AgentdSpawnOptions = {},
): AgentdProcessLike {
	const command = resolveAgentdCommand({
		executable: options.executable,
	});
	const spawn = options.spawn ?? defaultSpawn;
	const subprocess = spawn(command, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		stdin: fileSinkToWritableStream(subprocess.stdin),
		stdout: subprocess.stdout,
		stderr: subprocess.stderr,
		kill: () => subprocess.kill(),
	};
}

function defaultSpawn(
	command: string[],
	options: { stdin: "pipe"; stdout: "pipe"; stderr: "pipe" },
): BunPipeProcess {
	return Bun.spawn(command, options) as unknown as BunPipeProcess;
}

function fileSinkToWritableStream(
	sink: BunPipeProcess["stdin"],
): WritableStream<Uint8Array> {
	return new WritableStream<Uint8Array>({
		async write(chunk) {
			await sink.write(chunk);
			await sink.flush?.();
		},
		async close() {
			if (sink.end) await sink.end();
			else await sink.close?.();
		},
		abort() {
			sink.close?.();
		},
	});
}
