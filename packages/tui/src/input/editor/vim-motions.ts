import { nextTextBoundary, previousTextBoundary } from "./boundaries.ts";
import { previousTextGrapheme, textGraphemeAt } from "./graphemes.ts";
import {
	getFirstNonWhitespacePosition,
	getLineEnd,
	getLineInfo,
	getLineStart,
	isWhitespace,
	isWordChar,
} from "./vim-nav.ts";
import type { Motion } from "./vim-types.ts";

export const motions: Record<string, Motion> = {
	// In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
	// OR (2) a sequence of other non-blank characters (punctuation). These two
	// types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
	w: (text, cursorPosition) => {
		if (cursorPosition >= text.length) {
			return { start: cursorPosition, end: cursorPosition };
		}

		const currentChar = textGraphemeAt(text, cursorPosition);
		const endPosition = isWhitespace(currentChar)
			? skipWhitespaceForward(text, cursorPosition)
			: skipWhitespaceForward(
					text,
					skipWordClassForward(text, cursorPosition, isWordChar(currentChar)),
				);

		return { start: cursorPosition, end: endPosition };
	},
	// A "WORD" is a sequence of non-blank characters, separated by whitespace.
	// "foo-bar" is a single WORD, but "foo bar" is two WORDs.
	W: (text, cursorPosition) => {
		if (cursorPosition >= text.length) {
			return { start: cursorPosition, end: cursorPosition };
		}

		const currentChar = textGraphemeAt(text, cursorPosition);
		const endPosition = isWhitespace(currentChar)
			? skipWhitespaceForward(text, cursorPosition)
			: skipWhitespaceForward(
					text,
					skipNonWhitespaceForward(text, cursorPosition),
				);

		return { start: cursorPosition, end: endPosition };
	},
	// In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
	// OR (2) a sequence of other non-blank characters (punctuation). These two
	// types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
	b: (text, cursorPosition) => {
		if (cursorPosition === 0) {
			return { start: 0, end: 0 };
		}

		const afterWhitespace = skipWhitespaceBackward(text, cursorPosition);
		if (afterWhitespace === 0) return { start: 0, end: cursorPosition };
		const start = skipWordClassBackward(
			text,
			afterWhitespace,
			isWordChar(previousTextGrapheme(text, afterWhitespace)),
		);

		return { start, end: cursorPosition };
	},
	// A "WORD" is a sequence of non-blank characters, separated by whitespace.
	// "foo-bar" is a single WORD, but "foo bar" is two WORDs.
	B: (text, cursorPosition) => {
		if (cursorPosition === 0) {
			return { start: 0, end: 0 };
		}

		return {
			start: skipNonWhitespaceBackward(
				text,
				skipWhitespaceBackward(text, cursorPosition),
			),
			end: cursorPosition,
		};
	},
	e: (text, cursorPosition) => {
		const endPos = wordEndMotionPosition(text, cursorPosition);
		const vimEndPos = Math.max(0, endPos - 1);
		return { start: cursorPosition, end: vimEndPos + 1 };
	},
	"0": (text, cursorPosition) => {
		const currentLineInfo = getLineInfo(text, cursorPosition);
		const lineStart = getLineStart(text, currentLineInfo.lineIndex);
		return { start: lineStart, end: cursorPosition };
	},
	$: (text, cursorPosition) => {
		const currentLineInfo = getLineInfo(text, cursorPosition);
		const lineEnd = getLineEnd(text, currentLineInfo.lineIndex);
		return { start: cursorPosition, end: lineEnd + 1 };
	},
	"^": (text, cursorPosition) => {
		const currentLineInfo = getLineInfo(text, cursorPosition);
		const position = getFirstNonWhitespacePosition(
			text,
			currentLineInfo.lineIndex,
		);
		return { start: cursorPosition, end: position };
	},
};

function skipWordClassForward(
	text: string,
	position: number,
	wordClass: boolean,
): number {
	let nextPosition = position;
	while (nextPosition < text.length) {
		const char = textGraphemeAt(text, nextPosition);
		if (isWhitespace(char) || isWordChar(char) !== wordClass) break;
		nextPosition = nextTextBoundary(text, nextPosition);
	}
	return nextPosition;
}

function skipWhitespaceBackward(text: string, position: number): number {
	let previousPosition = position;
	while (previousPosition > 0) {
		const char = previousTextGrapheme(text, previousPosition);
		if (!isWhitespace(char)) break;
		previousPosition = previousTextBoundary(text, previousPosition);
	}
	return previousPosition;
}

function skipWordClassBackward(
	text: string,
	position: number,
	wordClass: boolean,
): number {
	let previousPosition = position;
	while (previousPosition > 0) {
		const char = previousTextGrapheme(text, previousPosition);
		if (isWhitespace(char) || isWordChar(char) !== wordClass) break;
		previousPosition = previousTextBoundary(text, previousPosition);
	}
	return previousPosition;
}

function skipNonWhitespaceBackward(text: string, position: number): number {
	let previousPosition = position;
	while (previousPosition > 0) {
		const char = previousTextGrapheme(text, previousPosition);
		if (isWhitespace(char)) break;
		previousPosition = previousTextBoundary(text, previousPosition);
	}
	return previousPosition;
}

function wordEndMotionPosition(text: string, cursorPosition: number): number {
	const start = isAtCurrentWordEnd(text, cursorPosition)
		? nextTextBoundary(text, cursorPosition)
		: cursorPosition;
	return skipNonWhitespaceForward(text, skipWhitespaceForward(text, start));
}

function isAtCurrentWordEnd(text: string, cursorPosition: number): boolean {
	const currentChar = textGraphemeAt(text, cursorPosition);
	const nextPosition = nextTextBoundary(text, cursorPosition);
	const nextChar =
		nextPosition < text.length ? textGraphemeAt(text, nextPosition) : "";
	return (
		!isWhitespace(currentChar) &&
		(nextPosition === text.length || isWhitespace(nextChar))
	);
}

function skipWhitespaceForward(text: string, position: number): number {
	let nextPosition = position;
	while (
		nextPosition < text.length &&
		isWhitespace(textGraphemeAt(text, nextPosition))
	) {
		nextPosition = nextTextBoundary(text, nextPosition);
	}
	return nextPosition;
}

function skipNonWhitespaceForward(text: string, position: number): number {
	let nextPosition = position;
	while (
		nextPosition < text.length &&
		!isWhitespace(textGraphemeAt(text, nextPosition))
	) {
		nextPosition = nextTextBoundary(text, nextPosition);
	}
	return nextPosition;
}
