import stringWidth from "string-width";

import { err, ok, type Result } from "./result.ts";

export const LINE_SPLIT_REGEX = /\r\n|\r|\n/;
const LEADING_WHITESPACE_REGEX = /(^\s+)/;
const TRAILING_WHITESPACE_REGEX = /(\s+$)/;
const WHITESPACE_REGEX = /\s/;

export type WrapResult = {
	wrapped: string;
	originalToWrapped: number[];
	wrappedToOriginal: number[];
};

export function countLines(content: string): number {
	return content.split("\n").length;
}

export function numWidth(num: number): number {
	return num.toString().length;
}

export function fileExtLanguage(filePath: string): string {
	const dotParts = filePath.split(".");
	let language = "txt";
	if (dotParts.length > 1) language = dotParts[dotParts.length - 1];
	return language;
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function extractTrim(line: string): [string, string, string] {
	let spaceBefore = "";
	let spaceAfter = "";

	const leadingWhitespace = line.match(LEADING_WHITESPACE_REGEX);
	const trailingWhitespace = line.match(TRAILING_WHITESPACE_REGEX);

	if (leadingWhitespace) spaceBefore = leadingWhitespace[1];
	if (trailingWhitespace) spaceAfter = trailingWhitespace[1];

	return [spaceBefore, line.trim(), spaceAfter];
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
	if (width <= 0) {
		const mapping = Array.from({ length: text.length + 1 }, (_, i) => i);
		return {
			wrapped: text,
			originalToWrapped: mapping,
			wrappedToOriginal: mapping,
		};
	}

	const state: WrapState = {
		text,
		width,
		effectiveWidth: firstLineWidth === undefined ? width : firstLineWidth,
		pastFirstLine: false,
		originalToWrapped: [],
		wrappedToOriginal: [],
		wrapped: "",
		wrappedPos: 0,
		originalPos: 0,
	};

	const paragraphs = text.split(LINE_SPLIT_REGEX);
	for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
		appendWrappedParagraph(state, paragraphs[pIndex]);
		if (pIndex < paragraphs.length - 1) appendOriginalNewline(state);
	}

	state.originalToWrapped[state.originalPos] = state.wrappedPos;
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;

	return {
		wrapped: state.wrapped,
		originalToWrapped: state.originalToWrapped,
		wrappedToOriginal: state.wrappedToOriginal,
	};
}

type WrapState = {
	text: string;
	width: number;
	effectiveWidth: number;
	pastFirstLine: boolean;
	originalToWrapped: number[];
	wrappedToOriginal: number[];
	wrapped: string;
	wrappedPos: number;
	originalPos: number;
};

function appendWrappedParagraph(state: WrapState, paragraph: string): void {
	if (paragraph.length === 0) {
		state.originalToWrapped[state.originalPos] = state.wrappedPos;
		return;
	}

	let lineWidth = 0;
	let lineStart = true;
	for (const word of splitIntoWords(paragraph)) {
		const result = appendWrappedWord(state, word, lineWidth, lineStart);
		lineWidth = result.lineWidth;
		lineStart = result.lineStart;
	}
}

function appendWrappedWord(
	state: WrapState,
	word: string,
	lineWidth: number,
	lineStart: boolean,
): { lineWidth: number; lineStart: boolean } {
	const wordWidth = stringWidth(word);
	let currentLineWidth = lineWidth;
	let currentLineStart = lineStart;

	if (
		!currentLineStart &&
		currentLineWidth + wordWidth >= state.effectiveWidth
	) {
		appendSoftNewline(state);
		currentLineWidth = 0;
		currentLineStart = true;
	}

	if (wordWidth >= state.effectiveWidth) {
		return appendLongWord(state, word, currentLineWidth, currentLineStart);
	}

	for (const char of word) appendOriginalChar(state, char);
	return { lineWidth: currentLineWidth + wordWidth, lineStart: false };
}

function appendLongWord(
	state: WrapState,
	word: string,
	lineWidth: number,
	lineStart: boolean,
): { lineWidth: number; lineStart: boolean } {
	let currentLineWidth = lineWidth;
	let currentLineStart = lineStart;

	for (const char of [...word]) {
		const charWidth = stringWidth(char);
		if (
			!currentLineStart &&
			currentLineWidth + charWidth >= state.effectiveWidth
		) {
			appendSoftNewline(state);
			currentLineWidth = 0;
		}

		appendOriginalChar(state, char);
		currentLineWidth += charWidth;
		currentLineStart = false;
	}

	return { lineWidth: currentLineWidth, lineStart: currentLineStart };
}

function appendOriginalNewline(state: WrapState): void {
	state.originalToWrapped[state.originalPos] = state.wrappedPos;
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;
	state.wrapped += "\n";
	state.wrappedPos++;
	state.originalPos++;
	switchToFullWidth(state);
}

function appendSoftNewline(state: WrapState): void {
	state.wrapped += "\n";
	state.wrappedToOriginal[state.wrappedPos] = -1;
	state.wrappedPos++;
	switchToFullWidth(state);
}

function appendOriginalChar(state: WrapState, char: string): void {
	state.originalToWrapped[state.originalPos] = state.wrappedPos;
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;
	state.wrapped += char;
	state.wrappedPos++;
	state.originalPos++;
}

function switchToFullWidth(state: WrapState): void {
	if (state.pastFirstLine) return;
	state.pastFirstLine = true;
	state.effectiveWidth = state.width;
}

function splitIntoWords(text: string): string[] {
	const words: string[] = [];
	let current = "";

	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		current += char;

		if (
			WHITESPACE_REGEX.test(char) &&
			i + 1 < text.length &&
			!WHITESPACE_REGEX.test(text[i + 1])
		) {
			words.push(current);
			current = "";
		}
	}

	if (current.length > 0) {
		words.push(current);
	}

	return words;
}
