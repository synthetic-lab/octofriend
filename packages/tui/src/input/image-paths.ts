import path from "node:path";
import { parse } from "shell-quote";
import { IMAGE_EXTENSIONS } from "./image-types.ts";

const CHARACTER_PLACEHOLDER = "_";

export function isImagePath(filePath: string): boolean {
	const trimmed = filePath.trim();
	if (!isFilePath(trimmed)) return false;
	const ext = path.extname(trimmed).toLowerCase();
	return ext in IMAGE_EXTENSIONS;
}

export function replaceInputWithSafeCharacters(input: string): string {
	let escaped = false;
	const sanitized = new Array<string>(input.length);
	let writeIndex = 0;
	let index = 0;
	while (index < input.length) {
		const charCode = input.charCodeAt(index);
		index += 1;
		if (charCode === 10 || charCode === 13) {
			sanitized[writeIndex] = String.fromCharCode(charCode);
		} else if (charCode === 92) {
			escaped = !escaped;
			sanitized[writeIndex] = CHARACTER_PLACEHOLDER;
		} else if (charCode === 32 && !escaped) {
			sanitized[writeIndex] = " ";
			escaped = false;
		} else {
			sanitized[writeIndex] = CHARACTER_PLACEHOLDER;
			escaped = false;
		}
		writeIndex += 1;
	}
	return sanitized.join("");
}

export function separateFilePaths(input: string): string[] {
	const placeholderInput = replaceInputWithSafeCharacters(input);
	const parsedPlaceholderInput = parse(placeholderInput);
	const separatedFilePaths: string[] = [];
	let cursor = 0;

	let parsedIndex = 0;
	while (parsedIndex < parsedPlaceholderInput.length) {
		const separatedPlaceholderPath = parsedPlaceholderInput[parsedIndex];
		parsedIndex += 1;
		if (typeof separatedPlaceholderPath === "string") {
			appendLfSeparatedFilePaths(
				separatedFilePaths,
				input.slice(cursor, cursor + separatedPlaceholderPath.length),
			);
			cursor = skipPreservedSeparators(
				placeholderInput,
				cursor + separatedPlaceholderPath.length,
			);
		}
	}
	return separatedFilePaths;
}

function skipPreservedSeparators(input: string, cursor: number): number {
	let index = cursor;
	while (
		index < input.length &&
		isPreservedSeparator(input.charCodeAt(index))
	) {
		index += 1;
	}
	return index;
}

function isPreservedSeparator(charCode: number): boolean {
	return charCode === 10 || charCode === 13 || charCode === 32;
}

export function parseImagePaths(input: string): string[] | null {
	const filePaths = separateFilePaths(
		dequoteType(dequoteType(input, "'"), '"'),
	);
	const imagePaths: string[] = [];

	let index = 0;
	while (index < filePaths.length) {
		const candidate = filePaths[index];
		index += 1;
		if (candidate === undefined) continue;
		const filePath = sanitizeFilePath(candidate);
		if (isImagePath(filePath)) {
			imagePaths[imagePaths.length] = filePath;
		} else {
			return null;
		}
	}

	return imagePaths;
}

function appendLfSeparatedFilePaths(target: string[], filePath: string): void {
	let lineStart = 0;
	const firstLf = filePath.indexOf("\n");
	if (firstLf === -1) {
		target[target.length] = filePath;
		return;
	}
	target[target.length] = filePath.slice(0, firstLf);
	lineStart = firstLf + 1;
	for (let index = lineStart; index < filePath.length; index += 1) {
		if (filePath.charCodeAt(index) !== 10) continue;
		target[target.length] = filePath.slice(lineStart, index);
		lineStart = index + 1;
	}
	target[target.length] = filePath.slice(lineStart);
}

function isFilePath(input: string): boolean {
	const parsed = path.parse(input);
	return parsed.dir !== "" || parsed.ext !== "";
}

function sanitizeFilePath(filePath: string): string {
	const trimmed = filePath.trim();
	let sawSlash = false;
	let sanitizedParts: string[] | undefined;
	let copyStart = 0;
	let index = 0;
	while (index < trimmed.length) {
		if (trimmed.charCodeAt(index) !== 92) {
			index += 1;
			continue;
		}
		sawSlash = true;
		if (sanitizedParts === undefined) sanitizedParts = [];
		if (index + 1 >= trimmed.length) break;
		if (copyStart < index)
			sanitizedParts[sanitizedParts.length] = trimmed.slice(copyStart, index);
		sanitizedParts[sanitizedParts.length] = trimmed[index + 1] ?? "";
		index += 2;
		copyStart = index;
	}
	if (!sawSlash) return trimmed;
	if (copyStart < trimmed.length) {
		if (sanitizedParts === undefined) return trimmed.slice(copyStart);
		sanitizedParts[sanitizedParts.length] = trimmed.slice(copyStart);
	}
	return sanitizedParts?.join("") ?? "";
}

function dequoteType(input: string, quoteType: string): string {
	const firstQuote = input.indexOf(quoteType);
	if (firstQuote === -1) return input;
	let inQuote = false;
	const parts: string[] = [];
	let copyStart = 0;

	let index = firstQuote;
	while (index < input.length) {
		const char = input[index] ?? "";
		if (char === quoteType) {
			appendDequoteSlice(parts, input, copyStart, index);
			inQuote = !inQuote;
			index += 1;
			copyStart = index;
			continue;
		}

		if (inQuote) {
			copyStart = appendQuotedCharacter(parts, input, copyStart, index, char);
		}
		index += 1;
	}

	appendDequoteSlice(parts, input, copyStart, input.length);
	return parts.join("");
}

function appendDequoteSlice(
	parts: string[],
	input: string,
	start: number,
	end: number,
): void {
	if (start < end) parts[parts.length] = input.slice(start, end);
}

function appendQuotedCharacter(
	parts: string[],
	input: string,
	copyStart: number,
	index: number,
	char: string,
): number {
	const quoted = quotedCharacter(char);
	if (quoted === char) return copyStart;
	appendDequoteSlice(parts, input, copyStart, index);
	parts[parts.length] = quoted;
	return index + 1;
}

function quotedCharacter(char: string): string {
	switch (char) {
		case " ":
			return "\\ ";
		case "\n":
			return "\\n";
		case "\r":
			return "\\\r";
		default:
			return char;
	}
}
