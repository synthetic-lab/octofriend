import type { VimKeyHandlerResult } from "./vim-types";

const WHITESPACE_PATTERN = /\s/;

export function isWhitespace(char: string): boolean {
	if (char.length === 0) return false;
	const code = char.charCodeAt(0);
	if (code === 32 || (code >= 9 && code <= 13)) return true;
	if (code < 128) return false;
	return WHITESPACE_PATTERN.test(char);
}

export const isNewline = (char: string): boolean =>
	char === "\n" || char === "\r";

export function isWordChar(char: string): boolean {
	if (char.length === 0) return false;
	const code = char.charCodeAt(0);
	return (
		code === 95 ||
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122)
	);
}

export const trimNewlinesFromEnd = (
	text: string,
	start: number,
	end: number,
): number => {
	let trimmedEnd = end;
	for (; trimmedEnd > start; trimmedEnd--) {
		const code = text.charCodeAt(trimmedEnd - 1);
		if (code !== 10 && code !== 13) break;
	}
	return trimmedEnd;
};

export const clampToVimBounds = (pos: number, textLength: number): number => {
	return Math.min(Math.max(0, pos), Math.max(0, textLength - 1));
};

export const vimCommandResult = (
	pos: number,
	textLength: number,
): VimKeyHandlerResult => ({
	consumed: true,
	newCursorPosition: clampToVimBounds(pos, textLength),
});

export const vimEarlyExit = (condition: boolean) => {
	if (condition) return { consumed: true };
	return null;
};

export const getLineInfo = (
	text: string,
	position: number,
): { lineIndex: number; columnIndex: number } => {
	let lineStart = 0;
	let lineIndex = 0;
	let index = lineBreakIndex(text, 0);
	while (index !== -1) {
		const breakLength = lineBreakLengthAt(text, index);
		if (position >= lineStart && position <= index) {
			return {
				lineIndex,
				columnIndex: Math.min(position, index) - lineStart,
			};
		}
		lineStart = index + breakLength;
		lineIndex++;
		index = lineBreakIndex(text, lineStart);
	}

	if (position >= lineStart && position <= text.length) {
		return {
			lineIndex,
			columnIndex: Math.min(position, text.length) - lineStart,
		};
	}

	return {
		lineIndex: Math.max(0, lineIndex),
		columnIndex: 0,
	};
};

export const getLineStart = (text: string, lineIndex: number): number => {
	if (lineIndex <= 0) return 0;
	let currentLine = 0;
	let index = lineBreakIndex(text, 0);
	while (index !== -1) {
		const breakLength = lineBreakLengthAt(text, index);
		currentLine++;
		if (currentLine === lineIndex) return index + breakLength;
		index = lineBreakIndex(text, index + breakLength);
	}
	return text.length + 1;
};

export const getLineEnd = (text: string, lineIndex: number): number => {
	const lineStart = getLineStart(text, lineIndex);
	const lineLength = getLineTextLength(text, lineIndex);
	return lineStart + Math.max(0, lineLength - 1);
};

export const getLineText = (text: string, lineIndex: number): string => {
	const line = getLineBounds(text, lineIndex);
	return line === null ? "" : text.slice(line.start, line.end);
};

function getLineTextLength(text: string, lineIndex: number): number {
	const line = getLineBounds(text, lineIndex);
	return line === null ? 0 : line.end - line.start;
}

type LineBounds = { start: number; end: number; breakEnd: number };

function getLineBounds(
	text: string,
	targetLineIndex: number,
): LineBounds | null {
	let lineStart = 0;
	let lineIndex = 0;
	let index = lineBreakIndex(text, 0);
	while (index !== -1) {
		const breakLength = lineBreakLengthAt(text, index);
		if (lineIndex === targetLineIndex) {
			return {
				start: lineStart,
				end: index,
				breakEnd: index + breakLength,
			};
		}
		lineStart = index + breakLength;
		lineIndex++;
		index = lineBreakIndex(text, lineStart);
	}
	return lineIndex === targetLineIndex
		? { start: lineStart, end: text.length, breakEnd: text.length }
		: null;
}

export const hasLineAfter = (text: string, lineIndex: number): boolean => {
	let currentLine = 0;
	let index = lineBreakIndex(text, 0);
	while (index !== -1) {
		const breakLength = lineBreakLengthAt(text, index);
		if (currentLine === lineIndex) return true;
		currentLine++;
		index = lineBreakIndex(text, index + breakLength);
	}
	return false;
};

export const getLineCount = (text: string): number => {
	let lineCount = 1;
	let index = lineBreakIndex(text, 0);
	while (index !== -1) {
		const breakLength = lineBreakLengthAt(text, index);
		lineCount++;
		index = lineBreakIndex(text, index + breakLength);
	}
	return lineCount;
};

export const getLineInsertEnd = (text: string, lineIndex: number): number => {
	const lineStart = getLineStart(text, lineIndex);
	const lineLength = getLineText(text, lineIndex).length;
	return lineStart + lineLength;
};

export const getTargetPosition = (
	text: string,
	lineIndex: number,
	columnIndex: number,
): number => {
	const line = getLineText(text, lineIndex);
	const targetCol =
		line.length === 0 ? 0 : Math.min(columnIndex, line.length - 1);
	return getLineStart(text, lineIndex) + targetCol;
};

export const getFirstNonWhitespacePosition = (
	text: string,
	lineIndex: number,
): number => {
	const lineStart = getLineStart(text, lineIndex);
	const lineEnd = getLineInsertEnd(text, lineIndex);

	let position = lineStart;

	while (position < lineEnd && isWhitespace(text[position])) {
		position++;
	}

	return position;
};

export const getLineRange = (
	text: string,
	cursorPosition: number,
): { start: number; end: number } => {
	const currentLineInfo = getLineInfo(text, cursorPosition);
	const line = getLineBounds(text, currentLineInfo.lineIndex);
	if (line === null) return { start: 0, end: 0 };
	return {
		start: line.start,
		end: line.breakEnd > line.end ? line.breakEnd : line.end,
	};
};

function lineBreakLengthAt(text: string, index: number): number {
	const code = text.charCodeAt(index);
	if (code === 13) return text.charCodeAt(index + 1) === 10 ? 2 : 1;
	return code === 10 ? 1 : 0;
}

function lineBreakIndex(text: string, start: number): number {
	const lfIndex = text.indexOf("\n", start);
	const crIndex = text.indexOf("\r", start);
	if (lfIndex === -1) return crIndex;
	if (crIndex === -1) return lfIndex;
	return lfIndex < crIndex ? lfIndex : crIndex;
}
