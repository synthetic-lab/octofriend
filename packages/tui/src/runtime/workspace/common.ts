import { agentdTransportRequestRaw } from "../agent/transport-request";
import { findFilesWithRemoteShell } from "./remote-find";

export type TransportDirectoryEntry = {
	entry: string;
	isDirectory: boolean;
};

export type ToolRunTransportContext =
	| { type: "local" }
	| { type: "docker"; container: string }
	| { type: "ssh"; target: string };

export type TransportIdentity = {
	readonly cwd: string;
	toolRunTransport?: () => ToolRunTransportContext;
};

export type TransportFileReader = {
	readFile: (signal: AbortSignal, file: string) => Promise<string>;
	pathExists: (signal: AbortSignal, file: string) => Promise<boolean>;
	isDirectory: (signal: AbortSignal, file: string) => Promise<boolean>;
	readdir: (
		signal: AbortSignal,
		dirpath: string,
	) => Promise<TransportDirectoryEntry[]>;
	modTime: (signal: AbortSignal, file: string) => Promise<number>;
	resolvePath: (signal: AbortSignal, path: string) => Promise<string>;
};

export type TransportFileWriter = {
	writeFile: (
		signal: AbortSignal,
		file: string,
		contents: string,
	) => Promise<void>;
	mkdir: (signal: AbortSignal, dirpath: string) => Promise<void>;
};

export type TransportExecution = {
	shell: (
		signal: AbortSignal,
		command: string,
		timeout: number,
	) => Promise<string>;
	close: () => Promise<void>;
};

export type Transport = TransportIdentity &
	TransportFileReader &
	TransportFileWriter &
	TransportExecution;

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
	try {
		const result = await agentdTransportRequestRaw(signal, method, params);
		if (!isRecord(result))
			return Promise.reject(new TransportError("Invalid transport response"));
		return result;
	} catch (error) {
		return Promise.reject(transportError(error));
	}
}

export function transportError(error: unknown): TransportError {
	if (error instanceof TransportError) return error;
	if (error instanceof Error) {
		const carrier = error as Error & { data?: unknown };
		const data = isRecord(carrier.data) ? carrier.data : {};
		const message =
			typeof data["message"] === "string" ? data["message"] : error.message;
		const exitCode =
			typeof data["exitCode"] === "number" ? data["exitCode"] : undefined;
		if (message === "Aborted") return new AbortError();
		if (exitCode !== undefined || message.startsWith("Command ")) {
			return new CommandFailedError(message, exitCode);
		}
		if (error.message === "agentd request aborted") {
			return new AbortError();
		}
		return new TransportError(message);
	}
	return new TransportError(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
