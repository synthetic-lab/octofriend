import type { FindFilesOptions, Transport } from "./common.ts";

const leadingDotSlashPattern = /^\.\//u;
const leadingSlashPattern = /^\//u;

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
	const trimmed = filePath.replace(leadingDotSlashPattern, "");
	if (searchRoot === ".") return trimmed;
	const normalizedRoot = searchRoot.replace(leadingDotSlashPattern, "");
	return trimmed.startsWith(`${normalizedRoot}/`)
		? trimmed.slice(normalizedRoot.length + 1)
		: trimmed.replace(leadingSlashPattern, "");
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
	return (
		nameIncluded(name, options) &&
		nameNotExcluded(name, options) &&
		pathIncluded(filePath, searchRoot, options) &&
		pathNotExcluded(filePath, searchRoot, options)
	);
}

function nameIncluded(name: string, options: FindFilesOptions): boolean {
	return options.includeName === undefined
		? true
		: wildcardMatches(
				options.includeName,
				name,
				options.caseInsensitive ?? false,
			);
}

function nameNotExcluded(name: string, options: FindFilesOptions): boolean {
	return options.excludeName === undefined
		? true
		: !wildcardMatches(options.excludeName, name, false);
}

function pathIncluded(
	filePath: string,
	searchRoot: string,
	options: FindFilesOptions,
): boolean {
	return options.includePath === undefined
		? true
		: pathPatternMatches(options.includePath, filePath, searchRoot);
}

function pathNotExcluded(
	filePath: string,
	searchRoot: string,
	options: FindFilesOptions,
): boolean {
	return options.excludePath === undefined
		? true
		: !pathPatternMatches(options.excludePath, filePath, searchRoot);
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
		} else if (starIndex === -1) {
			return false;
		} else {
			patternIndex = starIndex + 1;
			matchIndex += 1;
			valueIndex = matchIndex;
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
