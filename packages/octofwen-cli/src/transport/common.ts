import { spawnAgentdProcess } from "../bridge/node/platform.ts";
import { AgentdProcessClient } from "../bridge/process/client.ts";
import { AgentdJsonRpcError } from "../bridge/process/errors.ts";

export type TransportDirectoryEntry = {
	entry: string;
	isDirectory: boolean;
};

export type ToolRunTransportContext =
	| { type: "local" }
	| { type: "docker"; container: string }
	| { type: "ssh"; target: string };

export type Transport = {
	readonly cwd: string;
	toolRunTransport?: () => ToolRunTransportContext;
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
	shell: (
		signal: AbortSignal,
		command: string,
		timeout: number,
	) => Promise<string>;
	close: () => Promise<void>;
};

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

const excludedDirs = new Set([
	"node_modules",
	".git",
	".svn",
	".hg",
	".vscode",
	".idea",
	"dist",
	"build",
	"out",
	".next",
	"target",
	"bin",
	"obj",
	".turbo",
	".output",
	"__pycache__",
	".pytest_cache",
	".cache",
	"bower_components",
	".pnpm-store",
	"vendor",
	".npm",
	".sst",
	".webkit-cache",
	"mypy_cache",
	".history",
	".gradle",
]);

async function findFilesWithRemoteShell(
	signal: AbortSignal,
	transport: Transport,
	options: FindFilesOptions,
): Promise<string[]> {
	const searchRoot = options.path ?? ".";
	let command = `find ${shellQuote(searchRoot)} -mindepth 1`;
	if (options.maxDepth !== undefined) {
		command += ` -maxdepth ${options.maxDepth + 1}`;
	}
	command += ` ${excludedFindPruneExpression()} -o`;
	command +=
		options.type === "d" ? " -type d -print | sort" : " -type f -print | sort";
	const output = await transport.shell(signal, command, 30_000);
	const results: string[] = [];
	for (const line of output.split("\n")) {
		if (line.length === 0) continue;
		if (
			options.maxResults !== undefined &&
			options.maxResults > 0 &&
			results.length >= options.maxResults
		)
			break;
		const relative = remoteRelativePath(searchRoot, line);
		if (remotePathHasExcludedDir(relative)) continue;
		const name = relative.split("/").pop() ?? relative;
		if (!findFileEntryMatches(name, relative, searchRoot, options)) continue;
		results.push(relative);
	}
	return results;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function excludedFindPruneExpression(): string {
	return `\\( -type d \\( ${[...excludedDirs]
		.map((dir) => `-name ${shellQuote(dir)}`)
		.join(" -o ")} \\) -prune \\)`;
}

function remoteRelativePath(searchRoot: string, filePath: string): string {
	const trimmed = filePath.replace(/^\.\//u, "");
	if (searchRoot === ".") return trimmed;
	const normalizedRoot = searchRoot.replace(/^\.\//u, "");
	return trimmed.startsWith(`${normalizedRoot}/`)
		? trimmed.slice(normalizedRoot.length + 1)
		: trimmed.replace(/^\//u, "");
}

function remotePathHasExcludedDir(filePath: string): boolean {
	return filePath.split("/").some((part) => excludedDirs.has(part));
}

function findFileEntryMatches(
	name: string,
	filePath: string,
	searchRoot: string,
	options: FindFilesOptions,
): boolean {
	if (
		options.includeName !== undefined &&
		!wildcardMatches(
			options.includeName,
			name,
			options.caseInsensitive ?? false,
		)
	)
		return false;
	if (
		options.excludeName !== undefined &&
		wildcardMatches(options.excludeName, name, false)
	)
		return false;
	if (
		options.includePath !== undefined &&
		!pathPatternMatches(options.includePath, filePath, searchRoot)
	)
		return false;
	if (
		options.excludePath !== undefined &&
		pathPatternMatches(options.excludePath, filePath, searchRoot)
	)
		return false;
	return true;
}

function pathPatternMatches(
	pattern: string,
	filePath: string,
	searchRoot: string,
): boolean {
	if (wildcardMatches(pattern, filePath, false)) return true;
	if (searchRoot === ".") return false;
	return wildcardMatches(pattern, `${searchRoot}/${filePath}`, false);
}

function wildcardMatches(
	pattern: string,
	value: string,
	caseInsensitive: boolean,
): boolean {
	const patternBytes = [...(caseInsensitive ? pattern.toLowerCase() : pattern)];
	const valueBytes = [...(caseInsensitive ? value.toLowerCase() : value)];
	let patternIndex = 0;
	let valueIndex = 0;
	let starIndex = -1;
	let matchIndex = 0;
	while (valueIndex < valueBytes.length) {
		if (
			patternIndex < patternBytes.length &&
			(patternBytes[patternIndex] === "?" ||
				patternBytes[patternIndex] === valueBytes[valueIndex])
		) {
			patternIndex += 1;
			valueIndex += 1;
		} else if (
			patternIndex < patternBytes.length &&
			patternBytes[patternIndex] === "*"
		) {
			starIndex = patternIndex;
			matchIndex = valueIndex;
			patternIndex += 1;
		} else if (starIndex !== -1) {
			patternIndex = starIndex + 1;
			matchIndex += 1;
			valueIndex = matchIndex;
		} else {
			return false;
		}
	}
	while (
		patternIndex < patternBytes.length &&
		patternBytes[patternIndex] === "*"
	) {
		patternIndex += 1;
	}
	return patternIndex === patternBytes.length;
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
