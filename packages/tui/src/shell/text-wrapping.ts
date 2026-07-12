import stringWidth from "string-width";
import { nextTextBoundary } from "../input/editor/boundaries.ts";
import { isWhitespaceChar, isWhitespaceCode } from "./text-characters.ts";
import type { WrapResult } from "./text-processing.ts";

type WrapState = {
	text: string;
	width: number;
	effectiveWidth: number;
	pastFirstLine: boolean;
	originalToWrapped: number[];
	wrappedToOriginal: number[];
	wrappedParts: string[];
	wrappedPos: number;
	originalPos: number;
};

export function wrapTextWithMapping(
	text: string,
	width: number,
	firstLineWidth?: number,
): WrapResult {
	if (text.length === 0) {
		const mapping = [0];
		return {
			wrapped: "",
			originalToWrapped: mapping,
			wrappedToOriginal: mapping,
		};
	}
	if (width <= 0) {
		return identityWrapResult(text);
	}

	const effectiveWidth = firstLineWidth === undefined ? width : firstLineWidth;
	if (canReturnUnwrapped(text, effectiveWidth)) {
		return identityWrapResult(text);
	}

	const state: WrapState = {
		text,
		width,
		effectiveWidth,
		pastFirstLine: false,
		originalToWrapped: [],
		wrappedToOriginal: [],
		wrappedParts: [],
		wrappedPos: 0,
		originalPos: 0,
	};

	let paragraphStart = 0;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 10 && code !== 13) continue;
		appendWrappedParagraph(state, text.slice(paragraphStart, index));
		const newlineLength =
			code === 13 && text.charCodeAt(index + 1) === 10 ? 2 : 1;
		appendOriginalNewline(state, newlineLength);
		index += newlineLength - 1;
		paragraphStart = index + 1;
	}
	appendWrappedParagraph(state, text.slice(paragraphStart));

	state.originalToWrapped[state.originalPos] = state.wrappedPos;
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;

	return {
		wrapped: state.wrappedParts.join(""),
		originalToWrapped: state.originalToWrapped,
		wrappedToOriginal: state.wrappedToOriginal,
	};
}

function identityWrapResult(text: string): WrapResult {
	const mapping = new Array<number>(text.length + 1);
	let index = 0;
	while (index < text.length) {
		mapping[index] = index;
		const code = text.charCodeAt(index);
		index += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
	}
	mapping[text.length] = text.length;
	return {
		wrapped: text,
		originalToWrapped: mapping,
		wrappedToOriginal: mapping,
	};
}

function canReturnUnwrapped(text: string, effectiveWidth: number): boolean {
	let index = 0;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code === 10 || code === 13) return false;
		if (code < 32 || code > 126)
			return canReturnUnicodeUnwrapped(text, effectiveWidth);
		index += 1;
	}
	return (
		text.length < effectiveWidth ||
		(text.length === effectiveWidth && !isWhitespaceChar(text[text.length - 1]))
	);
}

function canReturnUnicodeUnwrapped(
	text: string,
	effectiveWidth: number,
): boolean {
	const width = stringWidth(text);
	return (
		width < effectiveWidth ||
		(width === effectiveWidth && !isWhitespaceChar(text[text.length - 1]))
	);
}

function visualWidth(text: string): number {
	let index = 0;
	while (index < text.length) {
		const code = text.charCodeAt(index);
		if (code < 32 || code > 126) return stringWidth(text);
		index += 1;
	}
	return text.length;
}

function charVisualWidth(char: string): number {
	const code = char.charCodeAt(0);
	return code >= 32 && code <= 126 ? 1 : stringWidth(char);
}

function appendWrappedParagraph(state: WrapState, paragraph: string): void {
	if (paragraph.length === 0) {
		state.originalToWrapped[state.originalPos] = state.wrappedPos;
		return;
	}

	let lineWidth = 0;
	let lineStart = true;
	let wordStart = 0;
	for (let index = 0; index < paragraph.length; index += 1) {
		const code = paragraph.charCodeAt(index);
		if (!isWhitespaceCode(code)) continue;
		const nextIndex = index + 1;
		if (
			nextIndex >= paragraph.length ||
			isWhitespaceCode(paragraph.charCodeAt(nextIndex))
		) {
			continue;
		}
		const result = appendWrappedWord(
			state,
			paragraph.slice(wordStart, nextIndex),
			lineWidth,
			lineStart,
		);
		lineWidth = result.lineWidth;
		lineStart = result.lineStart;
		wordStart = nextIndex;
	}

	if (wordStart < paragraph.length) {
		appendWrappedWord(state, paragraph.slice(wordStart), lineWidth, lineStart);
	}
}

function appendWrappedWord(
	state: WrapState,
	word: string,
	lineWidth: number,
	lineStart: boolean,
): { lineWidth: number; lineStart: boolean } {
	const wordWidth = visualWidth(word);
	let currentLineWidth = lineWidth;
	let currentLineStart = lineStart;

	const nextLineWidth = currentLineWidth + wordWidth;
	if (
		!currentLineStart &&
		(nextLineWidth > state.effectiveWidth ||
			(nextLineWidth === state.effectiveWidth &&
				isWhitespaceChar(word[word.length - 1])))
	) {
		appendSoftNewline(state);
		currentLineWidth = 0;
		currentLineStart = true;
	}

	if (
		wordWidth > state.effectiveWidth ||
		(wordWidth === state.effectiveWidth &&
			isWhitespaceChar(word[word.length - 1]))
	) {
		return appendLongWord(state, word, currentLineWidth, currentLineStart);
	}

	appendOriginalText(state, word);
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

	let index = 0;
	while (index < word.length) {
		const code = word.charCodeAt(index);
		if (code < 32 || code > 126) {
			const result = appendLongGrapheme(
				state,
				word,
				index,
				currentLineWidth,
				currentLineStart,
			);
			currentLineWidth = result.lineWidth;
			currentLineStart = result.lineStart;
			index = result.nextIndex;
			continue;
		}

		const charWidth = 1;
		const nextLineWidth = currentLineWidth + charWidth;
		if (
			!currentLineStart &&
			(nextLineWidth > state.effectiveWidth ||
				(nextLineWidth === state.effectiveWidth && isWhitespaceCode(code)))
		) {
			appendSoftNewline(state);
			currentLineWidth = 0;
		}

		appendOriginalCodeUnit(state, word, index);
		currentLineWidth += charWidth;
		currentLineStart = false;
		index += 1;
	}

	return { lineWidth: currentLineWidth, lineStart: currentLineStart };
}

function appendLongGrapheme(
	state: WrapState,
	word: string,
	index: number,
	lineWidth: number,
	lineStart: boolean,
): { lineWidth: number; lineStart: boolean; nextIndex: number } {
	const nextIndex = nextTextBoundary(word, index);
	if (nextIndex <= index) {
		return { lineWidth, lineStart, nextIndex: word.length };
	}
	const grapheme = word.slice(index, nextIndex);
	const charWidth = charVisualWidth(grapheme);
	const nextLineWidth = lineWidth + charWidth;
	let currentLineWidth = lineWidth;
	if (
		!lineStart &&
		(nextLineWidth > state.effectiveWidth ||
			(nextLineWidth === state.effectiveWidth && isWhitespaceChar(grapheme)))
	) {
		appendSoftNewline(state);
		currentLineWidth = 0;
	}

	appendOriginalChar(state, grapheme);
	return {
		lineWidth: currentLineWidth + charWidth,
		lineStart: false,
		nextIndex,
	};
}

function appendOriginalNewline(state: WrapState, originalLength: number): void {
	for (let index = 0; index < originalLength; index += 1) {
		state.originalToWrapped[state.originalPos + index] = state.wrappedPos;
	}
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;
	state.wrappedParts.push("\n");
	state.wrappedPos++;
	state.originalPos += originalLength;
	switchToFullWidth(state);
}

function appendSoftNewline(state: WrapState): void {
	state.wrappedParts.push("\n");
	state.wrappedToOriginal[state.wrappedPos] = -1;
	state.wrappedPos++;
	switchToFullWidth(state);
}

function appendOriginalText(state: WrapState, text: string): void {
	if (text.length === 0) return;
	const wrappedStart = state.wrappedPos;
	const originalStart = state.originalPos;
	state.wrappedParts.push(text);
	let index = 0;
	while (index < text.length) {
		state.originalToWrapped[originalStart + index] = wrappedStart + index;
		state.wrappedToOriginal[wrappedStart + index] = originalStart + index;
		const code = text.charCodeAt(index);
		index += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
	}
	state.wrappedPos = wrappedStart + text.length;
	state.originalPos = originalStart + text.length;
}

function appendOriginalChar(state: WrapState, char: string): void {
	state.originalToWrapped[state.originalPos] = state.wrappedPos;
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;
	state.wrappedParts.push(char);
	state.wrappedPos += char.length;
	state.originalPos += char.length;
}

function appendOriginalCodeUnit(
	state: WrapState,
	text: string,
	index: number,
): void {
	state.originalToWrapped[state.originalPos] = state.wrappedPos;
	state.wrappedToOriginal[state.wrappedPos] = state.originalPos;
	state.wrappedParts.push(text[index] ?? "");
	state.wrappedPos += 1;
	state.originalPos += 1;
}

function switchToFullWidth(state: WrapState): void {
	if (state.pastFirstLine) return;
	state.pastFirstLine = true;
	state.effectiveWidth = state.width;
}
