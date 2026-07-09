import ignore from "ignore";
import type { Transport } from "../runtime/workspace/common";
import { findFiles } from "../runtime/workspace/common";

const MAX_SUGGESTIONS = 8;
const CACHE_TTL = 5000;
const GITIGNORE_CACHE_TTL = 300000;

type FileListEntry = {
	files: string[];
	timestamp: number;
};

type GitignoreCacheEntry = {
	content: string;
	timestamp: number;
};

const fileCache = new Map<string, FileListEntry>();
const pendingRequests = new Map<
	string,
	{ promise: Promise<string[]>; signal: AbortSignal }
>();
const gitignoreCache = new Map<string, GitignoreCacheEntry>();

async function getGitignoreFilter(
	transport: Transport,
	signal: AbortSignal,
): Promise<ignore.Ignore> {
	const cwd = transport.cwd;
	const cacheKey = transportCacheKey(transport);
	const cached = gitignoreCache.get(cacheKey);
	const now = Date.now();

	if (cached && now - cached.timestamp < GITIGNORE_CACHE_TTL) {
		return ignore().add(cached.content);
	}

	const gitignorePath = `${cwd}/.gitignore`;
	let content: string;

	try {
		content = await transport.readFile(signal, gitignorePath);
	} catch {
		return ignore();
	}

	gitignoreCache.set(cacheKey, { content, timestamp: now });
	return ignore().add(content);
}

async function getCachedFileList(
	transport: Transport,
	signal: AbortSignal,
): Promise<string[]> {
	const cacheKey = transportCacheKey(transport);
	const now = Date.now();
	const cached = fileCache.get(cacheKey);

	if (cached && now - cached.timestamp < CACHE_TTL) {
		return cached.files;
	}

	const pending = pendingRequests.get(cacheKey);
	if (pending) {
		if (!pending.signal.aborted) return pending.promise;
		pendingRequests.delete(cacheKey);
	}

	const ig = await getGitignoreFilter(transport, signal);

	const promise = findFiles(signal, transport, {
		type: "f",
	}).then((files) => filterIgnoredFiles(files, ig).sort(comparePathLength));

	pendingRequests.set(cacheKey, { promise, signal });

	try {
		const files = await promise;
		fileCache.set(cacheKey, { files, timestamp: now });
		return files;
	} finally {
		pendingRequests.delete(cacheKey);
	}
}

function transportCacheKey(transport: Transport): string {
	const context = transport.toolRunTransport?.();
	if (context?.type === "docker") {
		return `docker:${context.container}:${transport.cwd}`;
	}
	if (context?.type === "ssh") {
		return `ssh:${context.target}:${transport.cwd}`;
	}
	return `local:${transport.cwd}`;
}

function filterIgnoredFiles(files: string[], ig: ignore.Ignore): string[] {
	const filtered = new Array<string>(files.length);
	let index = 0;
	let writeIndex = 0;
	while (index < files.length) {
		const file = files[index];
		if (file !== undefined && !ig.ignores(file)) {
			filtered[writeIndex] = file;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < filtered.length) filtered.length = writeIndex;
	return filtered;
}

function comparePathLength(left: string, right: string): number {
	return left.length - right.length;
}

export async function searchFiles(
	query: string,
	transport: Transport,
	signal: AbortSignal,
): Promise<string[]> {
	const files = await getCachedFileList(transport, signal);

	if (!query) return firstSuggestions(files);

	const matches = new Array<string>(MAX_SUGGESTIONS);
	const matchesQuery = createFileMatcher(query);
	let index = 0;
	let writeIndex = 0;
	while (index < files.length && writeIndex < MAX_SUGGESTIONS) {
		const file = files[index];
		if (file !== undefined && matchesQuery(file)) {
			matches[writeIndex] = file;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < matches.length) matches.length = writeIndex;
	return matches;
}

function firstSuggestions(files: string[]): string[] {
	const count = Math.min(MAX_SUGGESTIONS, files.length);
	const result = new Array<string>(count);
	for (let index = 0; index < count; index += 1) {
		result[index] = files[index] as string;
	}
	return result;
}

type FileMatcher = (value: string) => boolean;

function createFileMatcher(query: string): FileMatcher {
	const queryCodes = lowerAsciiQueryCodes(query);
	if (queryCodes === null) {
		const lowerQuery = query.toLowerCase();
		return (value) => value.toLowerCase().includes(lowerQuery);
	}
	let lowerQuery: string | undefined;
	return (value) => {
		const asciiMatch = includesLowerAscii(value, queryCodes);
		if (asciiMatch !== null) return asciiMatch;
		lowerQuery ??= query.toLowerCase();
		return value.toLowerCase().includes(lowerQuery);
	};
}

function lowerAsciiQueryCodes(query: string): Uint16Array | null {
	const queryCodes = new Uint16Array(query.length);
	let index = 0;
	while (index < query.length) {
		const charCode = query.charCodeAt(index);
		if (charCode > 127) return null;
		queryCodes[index] = lowerAsciiCode(charCode);
		index += 1;
	}
	return queryCodes;
}

function includesLowerAscii(
	value: string,
	queryCodes: Uint16Array,
): boolean | null {
	const queryLength = queryCodes.length;
	if (queryLength === 0) return true;
	const lastStart = value.length - queryLength;
	const firstQueryCode = queryCodes[0] as number;
	let start = 0;
	while (start <= lastStart) {
		const firstValueCode = value.charCodeAt(start);
		if (firstValueCode > 127) return null;
		if (lowerAsciiCode(firstValueCode) === firstQueryCode) {
			const match = lowerAsciiMatchAt(value, queryCodes, start);
			if (match !== false) return match;
		}
		start += 1;
	}
	return false;
}

function lowerAsciiMatchAt(
	value: string,
	queryCodes: Uint16Array,
	start: number,
): boolean | null {
	let offset = 1;
	while (offset < queryCodes.length) {
		const valueCode = value.charCodeAt(start + offset);
		if (valueCode > 127) return null;
		if (lowerAsciiCode(valueCode) !== queryCodes[offset]) return false;
		offset += 1;
	}
	return true;
}

function lowerAsciiCode(charCode: number): number {
	return charCode >= 65 && charCode <= 90 ? charCode + 32 : charCode;
}
