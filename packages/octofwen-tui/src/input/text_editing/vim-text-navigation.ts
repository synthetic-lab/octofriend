import type { VimKeyHandlerResult } from "./vim-types.ts";

const WHITESPACE_PATTERN = /\s/;
const WORD_CHARACTER_PATTERN = /[a-zA-Z0-9_]/;

export const isWhitespace = (char: string): boolean =>
	WHITESPACE_PATTERN.test(char);
export const isNewline = (char: string): boolean => char === "\n";
export const isWordChar = (char: string): boolean =>
	WORD_CHARACTER_PATTERN.test(char);

export const trimNewlinesFromEnd = (
	text: string,
	start: number,
	end: number,
): number => {
	let trimmedEnd = end;
	for (; trimmedEnd > start; trimmedEnd--) {
		if (!isNewline(text[trimmedEnd - 1])) break;
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
	const lines = text.split("\n");
	let currentPos = 0;

	for (let i = 0; i < lines.length; i++) {
		const lineLength = lines[i].length;
		if (position >= currentPos && position <= currentPos + lineLength) {
			return {
				lineIndex: i,
				columnIndex: position - currentPos,
			};
		}
		currentPos += lineLength + 1; // +1 for the newline
	}

	// If position is at the very end (after last newline), return last line
	return {
		lineIndex: lines.length - 1,
		columnIndex: lines[lines.length - 1]?.length || 0,
	};
};

export const getLineStart = (text: string, lineIndex: number): number => {
	const lines = text.split("\n");
	let position = 0;

	for (let i = 0; i < lineIndex && i < lines.length; i++) {
		position += lines[i].length + 1; // +1 for the newline
	}

	return position;
};

export const getLineEnd = (text: string, lineIndex: number): number => {
	const lineStart = getLineStart(text, lineIndex);
	const lines = text.split("\n");
	const lineLength = lines[lineIndex]?.length || 0;
	return lineStart + Math.max(0, lineLength - 1);
};

export const getLineText = (text: string, lineIndex: number): string => {
	const lines = text.split("\n");
	return lines[lineIndex] || "";
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
	const start = getLineStart(text, currentLineInfo.lineIndex);
	const lines = text.split("\n");
	const line = getLineText(text, currentLineInfo.lineIndex);
	let end = start + line.length;
	if (currentLineInfo.lineIndex < lines.length - 1) {
		end += 1; // Include the newline character
	}
	return { start, end };
};
