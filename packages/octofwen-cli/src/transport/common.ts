import { spawnAgentdProcess } from "../bridge/node/platform.ts";
import { AgentdProcessClient } from "../bridge/process/client.ts";
import { AgentdJsonRpcError } from "../bridge/process/errors.ts";
import { findFilesWithRemoteShell } from "./remote-find.ts";

export type TransportDirectoryEntry = {
	entry: string;
	isDirectory: boolean;
};

export type ToolRunTransportContext =
	| { type: "local" }
	| { type: "docker"; container: string }
	| { type: "ssh"; target: string };

type TransportIdentity = {
	readonly cwd: string;
	toolRunTransport?: () => ToolRunTransportContext;
};

type TransportFileOps = {
	writeFile: (
		signal: AbortSignal,
		file: string,
		contents: string,
	) => Promise<void>;
	readFile: (signal: AbortSignal, file: string) => Promise<string>;
	pathExists: (signal: AbortSignal, file: string) => Promise<boolean>;
	isDirectory: (signal: AbortSignal, file: string) => Promise<boolean>;
	mkdir: (signal: AbortSignal, dirpath: string) => Promise<void>;
	readdir: (
		signal: AbortSignal,
		dirpath: string,
	) => Promise<TransportDirectoryEntry[]>;
	modTime: (signal: AbortSignal, file: string) => Promise<number>;
	resolvePath: (signal: AbortSignal, path: string) => Promise<string>;
};

type TransportProcessOps = {
	shell: (
		signal: AbortSignal,
		command: string,
		timeout: number,
	) => Promise<string>;
	close: () => Promise<void>;
};

export type Transport = TransportIdentity &
	TransportFileOps &
	TransportProcessOps;

export type FindFilesOptions = {
	path?: string;
	includeName?: string;
	includePath?: string;
	excludeName?: string;
	excludePath?: string;
	caseInsensitive?: boolean;
	type?: "f" | "d";
	maxDepth?: number;
	maxResults?: number;
};

export class TransportError extends Error {
	constructor(msg: string) {
		super(msg);
		this.name = this.constructor.name;
	}
}

export class CommandFailedError extends TransportError {
	exitCode?: number;

	constructor(msg: string, exitCode?: number) {
		super(msg);
		this.exitCode = exitCode;
	}
}

export class AbortError extends TransportError {
	constructor() {
		super("Aborted");
	}
}

export async function findFiles(
	signal: AbortSignal,
	transport: Transport,
	options: FindFilesOptions = {},
): Promise<string[]> {
	const transportContext = transport.toolRunTransport?.();
	if (transportContext?.type === "docker" || transportContext?.type === "ssh") {
		return findFilesWithRemoteShell(signal, transport, options);
	}
	const result = await agentdTransportRequest(
		signal,
		"octofwen.agentd/transportFindFiles",
		{
			cwd: transport.cwd,
			options,
		},
	);
	return result["files"] as string[];
}

export async function getEnvVar(
	signal: AbortSignal,
	transport: Transport,
	envVarName: string,
	timeout: number,
): Promise<string> {
	const result = await agentdTransportRequest(
		signal,
		"octofwen.agentd/transportGetEnv",
		{
			cwd: transport.cwd,
			name: envVarName,
			timeoutMs: timeout,
		},
	);
	return result["value"] as string;
}

export async function agentdTransportRequest(
	signal: AbortSignal,
	method: string,
	params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (signal.aborted) return Promise.reject(new AbortError());
	const client = new AgentdProcessClient(spawnAgentdProcess());
	try {
		const result = await client.request(method, params, {
			abortSignal: signal,
			cancelOnAbort: true,
		});
		if (!isRecord(result))
			return Promise.reject(new TransportError("Invalid transport response"));
		return result;
	} catch (error) {
		return Promise.reject(transportError(error));
	} finally {
		client.close();
	}
}

export function transportError(error: unknown): TransportError {
	if (error instanceof TransportError) return error;
	if (error instanceof AgentdJsonRpcError) return agentdTransportError(error);
	if (error instanceof Error && error.message === "agentd request aborted") {
		return new AbortError();
	}
	return new TransportError(
		error instanceof Error ? error.message : String(error),
	);
}

function agentdTransportError(error: AgentdJsonRpcError): TransportError {
	const data = isRecord(error.data) ? error.data : {};
	const message =
		typeof data["message"] === "string" ? data["message"] : error.message;
	const exitCode =
		typeof data["exitCode"] === "number" ? data["exitCode"] : undefined;
	if (message === "Aborted") return new AbortError();
	if (exitCode !== undefined || message.startsWith("Command ")) {
		return new CommandFailedError(message, exitCode);
	}
	return new TransportError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
