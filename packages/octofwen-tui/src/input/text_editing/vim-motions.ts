import {
	getFirstNonWhitespacePosition,
	getLineEnd,
	getLineInfo,
	getLineStart,
	isWhitespace,
	isWordChar,
} from "./vim-text-navigation.ts";
import type { Motion } from "./vim-types.ts";

export const motions: Record<string, Motion> = {
	// In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
	// OR (2) a sequence of other non-blank characters (punctuation). These two
	// types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
	w: (text, cursorPosition) => {
		const textLength = text.length;
		if (cursorPosition >= textLength) {
			return { start: cursorPosition, end: cursorPosition };
		}

		const currentChar = text[cursorPosition];
		let endPosition: number;

		if (isWhitespace(currentChar)) {
			// In whitespace: skip to the next non-whitespace
			endPosition = cursorPosition;
			while (endPosition < textLength && isWhitespace(text[endPosition])) {
				endPosition++;
			}
		} else {
			// On a non-whitespace char: skip chars of the same class, then skip whitespace
			const currentCharIsWord = isWordChar(currentChar);
			endPosition = cursorPosition;

			// Skip characters of the same class
			while (endPosition < textLength && !isWhitespace(text[endPosition])) {
				const charIsWord = isWordChar(text[endPosition]);
				if (charIsWord !== currentCharIsWord) {
					break;
				}
				endPosition++;
			}

			// Skip trailing whitespace to reach start of next word/WORD
			while (endPosition < textLength && isWhitespace(text[endPosition])) {
				endPosition++;
			}
		}

		return { start: cursorPosition, end: endPosition };
	},
	// A "WORD" is a sequence of non-blank characters, separated by whitespace.
	// "foo-bar" is a single WORD, but "foo bar" is two WORDs.
	W: (text, cursorPosition) => {
		const textLength = text.length;
		if (cursorPosition >= textLength) {
			return { start: cursorPosition, end: cursorPosition };
		}

		const currentChar = text[cursorPosition];
		let endPosition: number;

		if (isWhitespace(currentChar)) {
			// In whitespace: skip to the next non-whitespace
			endPosition = cursorPosition;
			while (endPosition < textLength && isWhitespace(text[endPosition])) {
				endPosition++;
			}
		} else {
			// On a non-whitespace char: skip the entire WORD, then skip whitespace
			endPosition = cursorPosition;
			while (endPosition < textLength && !isWhitespace(text[endPosition])) {
				endPosition++;
			}
			while (endPosition < textLength && isWhitespace(text[endPosition])) {
				endPosition++;
			}
		}

		return { start: cursorPosition, end: endPosition };
	},
	// In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
	// OR (2) a sequence of other non-blank characters (punctuation). These two
	// types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
	b: (text, cursorPosition) => {
		if (cursorPosition === 0) {
			return { start: 0, end: 0 };
		}

		let start = cursorPosition;

		// Skip whitespace
		while (start > 0 && isWhitespace(text[start - 1])) {
			start--;
		}

		// If we're at the start of the text after skipping whitespace, we're done
		if (start === 0) {
			return { start: 0, end: cursorPosition };
		}

		// Determine the character class of the first non-whitespace char we're on
		const firstNonWsChar = text[start - 1];
		const firstCharIsWord = isWordChar(firstNonWsChar);

		// Continue skipping characters of the same class
		while (start > 0 && !isWhitespace(text[start - 1])) {
			const currentChar = text[start - 1];
			const currentCharIsWord = isWordChar(currentChar);
			// Stop when we hit a different character class
			if (currentCharIsWord !== firstCharIsWord) {
				break;
			}
			start--;
		}

		return { start: start, end: cursorPosition };
	},
	// A "WORD" is a sequence of non-blank characters, separated by whitespace.
	// "foo-bar" is a single WORD, but "foo bar" is two WORDs.
	B: (text, cursorPosition) => {
		if (cursorPosition === 0) {
			return { start: 0, end: 0 };
		}

		let start = cursorPosition;

		// Skip whitespace
		while (start > 0 && isWhitespace(text[start - 1])) {
			start--;
		}

		// Skip all non-whitespace characters (the entire WORD)
		while (start > 0 && !isWhitespace(text[start - 1])) {
			start--;
		}

		return { start: start, end: cursorPosition };
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

function wordEndMotionPosition(text: string, cursorPosition: number): number {
	const start = isAtCurrentWordEnd(text, cursorPosition)
		? cursorPosition + 1
		: cursorPosition;
	return skipNonWhitespaceForward(text, skipWhitespaceForward(text, start));
}

function isAtCurrentWordEnd(text: string, cursorPosition: number): boolean {
	const currentChar = text[cursorPosition];
	const nextChar =
		cursorPosition + 1 < text.length ? text[cursorPosition + 1] : "";
	return (
		!isWhitespace(currentChar) &&
		(cursorPosition === text.length - 1 || isWhitespace(nextChar))
	);
}

function skipWhitespaceForward(text: string, position: number): number {
	let nextPosition = position;
	while (nextPosition < text.length && isWhitespace(text[nextPosition])) {
		nextPosition++;
	}
	return nextPosition;
}

function skipNonWhitespaceForward(text: string, position: number): number {
	let nextPosition = position;
	while (nextPosition < text.length && !isWhitespace(text[nextPosition])) {
		nextPosition++;
	}
	return nextPosition;
}
