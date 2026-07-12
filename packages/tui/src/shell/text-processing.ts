import { err, ok, type Result } from "./result.ts";
import { isWhitespaceCode } from "./text-characters.ts";

import { wrapTextWithMapping as wrapTextWithMappingImpl } from "./text-wrapping.ts";

export const LINE_SPLIT_REGEX = /\r\n|\r|\n/;
export type WrapResult = {
	wrapped: string;
	originalToWrapped: number[];
	wrappedToOriginal: number[];
};

export function countLines(content: string): number {
	const firstLf = content.indexOf("\n");
	if (firstLf === -1) return 1;
	let lines = 1;
	for (let index = firstLf; index < content.length; index += 1) {
		if (content.charCodeAt(index) === 10) lines += 1;
	}
	return lines;
}

export function numWidth(num: number): number {
	return num.toString().length;
}

export function fileExtLanguage(filePath: string): string {
	const dotIndex = filePath.lastIndexOf(".");
	return dotIndex === -1 ? "txt" : filePath.slice(dotIndex + 1);
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function hasNonWhitespace(text: string): boolean {
	let index = 0;
	while (index < text.length) {
		if (!isWhitespaceCode(text.charCodeAt(index))) return true;
		index += 1;
	}
	return false;
}

export function trimWhitespace(text: string): string {
	return nonEmptyTrimmedText(text) ?? "";
}

export function nonEmptyTrimmedText(text: string): string | null {
	const bounds = trimWhitespaceBounds(text);
	if (bounds === null) return null;
	if (bounds.start === 0 && bounds.end === text.length) return text;
	return text.slice(bounds.start, bounds.end);
}

function trimWhitespaceBounds(
	text: string,
): { start: number; end: number } | null {
	let firstContent = 0;
	while (
		firstContent < text.length &&
		isWhitespaceCode(text.charCodeAt(firstContent))
	) {
		firstContent += 1;
	}

	if (firstContent === text.length) return null;

	let lastContent = text.length - 1;
	while (
		lastContent > firstContent &&
		isWhitespaceCode(text.charCodeAt(lastContent))
	) {
		lastContent -= 1;
	}

	return { start: firstContent, end: lastContent + 1 };
}

export function extractTrim(line: string): [string, string, string] {
	const bounds = trimWhitespaceBounds(line);
	if (bounds === null) return [line, "", ""];

	return [
		line.slice(0, bounds.start),
		line.slice(bounds.start, bounds.end),
		line.slice(bounds.end),
	];
}

export function insertAt(
	str: string,
	index: number,
	add: string,
): Result<string, string> {
	if (str.length === index + 1) return ok(str + add);
	if (index === 0) return ok(add + str);
	if (index >= str.length) return err("inserting past end of string");
	return ok(str.slice(0, index) + add + str.slice(index));
}

export function cutIndex(str: string, index: number): Result<string, string> {
	if (str.length === index + 1) return ok(str.slice(0, index));
	if (index === 0) return ok(str.slice(1));
	if (index >= str.length) return err("cutting past end of string");
	return ok(str.slice(0, index) + str.slice(index + 1));
}

export function wrapTextWithMapping(
	text: string,
	width: number,
	firstLineWidth?: number,
): WrapResult {
	return wrapTextWithMappingImpl(text, width, firstLineWidth);
}
