import type { FindFilesOptions, Transport } from "./common.ts";
import { pathPatternMatches, wildcardMatches } from "./wildcard.ts";

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

export async function findFilesWithRemoteShell(
	signal: AbortSignal,
	transport: Transport,
	options: FindFilesOptions,
): Promise<string[]> {
	const searchRoot = options.path ?? ".";
	const commandParts = [`find ${shellQuote(searchRoot)} -mindepth 1`];
	if (options.maxDepth !== undefined) {
		commandParts[commandParts.length] = ` -maxdepth ${options.maxDepth + 1}`;
	}
	commandParts[commandParts.length] = ` ${excludedFindPruneExpression()} -o`;
	commandParts[commandParts.length] =
		options.type === "d" ? " -type d -print | sort" : " -type f -print | sort";
	const command = commandParts.join("");
	const output = await transport.shell(signal, command, 30_000);
	return collectRemoteFindResults(output, searchRoot, options);
}

function collectRemoteFindResults(
	output: string,
	searchRoot: string,
	options: FindFilesOptions,
): string[] {
	const results: string[] = [];
	let lineStart = 0;
	for (let index = 0; index <= output.length; index += 1) {
		const isEnd = index === output.length;
		if (!isEnd && output.charCodeAt(index) !== 10) continue;
		if (lineStart === index) {
			if (isEnd) break;
			lineStart = index + 1;
			continue;
		}
		if (remoteFindResultLimitReached(results, options)) {
			break;
		}
		appendRemoteFindLine(
			results,
			output.slice(lineStart, index),
			searchRoot,
			options,
		);
		if (isEnd) break;
		lineStart = index + 1;
	}
	return results;
}

function remoteFindResultLimitReached(
	results: string[],
	options: FindFilesOptions,
): boolean {
	return (
		options.maxResults !== undefined &&
		options.maxResults > 0 &&
		results.length >= options.maxResults
	);
}

function appendRemoteFindLine(
	results: string[],
	line: string,
	searchRoot: string,
	options: FindFilesOptions,
): void {
	const relative = remoteRelativePath(searchRoot, line);
	if (remotePathHasExcludedDir(relative)) return;
	const name = remotePathBasename(relative);
	if (findFileEntryMatches(name, relative, searchRoot, options)) {
		results.push(relative);
	}
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function excludedFindPruneExpression(): string {
	const parts = new Array<string>(1 + excludedDirs.size * 2);
	let writeIndex = 0;
	parts[writeIndex] = "\\( -type d \\( ";
	writeIndex += 1;
	for (const dir of excludedDirs) {
		if (writeIndex > 1) {
			parts[writeIndex] = " -o ";
			writeIndex += 1;
		}
		parts[writeIndex] = `-name ${shellQuote(dir)}`;
		writeIndex += 1;
	}
	parts[writeIndex] = " \\) -prune \\)";
	return parts.join("");
}

function stripLeadingDotSlash(value: string): string {
	return value.startsWith("./") ? value.slice(2) : value;
}

function stripLeadingSlash(value: string): string {
	return value.startsWith("/") ? value.slice(1) : value;
}

function remoteRelativePath(searchRoot: string, filePath: string): string {
	const trimmed = stripLeadingDotSlash(filePath);
	if (searchRoot === ".") return trimmed;
	const normalizedRoot = stripLeadingDotSlash(searchRoot);
	return trimmed.startsWith(`${normalizedRoot}/`)
		? trimmed.slice(normalizedRoot.length + 1)
		: stripLeadingSlash(trimmed);
}

function remotePathHasExcludedDir(filePath: string): boolean {
	let partStart = 0;
	for (let index = 0; index <= filePath.length; index += 1) {
		const isEnd = index === filePath.length;
		if (!isEnd && filePath.charCodeAt(index) !== 47) continue;
		if (excludedDirs.has(filePath.slice(partStart, index))) return true;
		if (isEnd) break;
		partStart = index + 1;
	}
	return false;
}

function remotePathBasename(filePath: string): string {
	const slashIndex = filePath.lastIndexOf("/");
	return slashIndex === -1 ? filePath : filePath.slice(slashIndex + 1);
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
