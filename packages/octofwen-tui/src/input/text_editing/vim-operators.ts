import {
	getLineInfo,
	getLineText,
	isNewline,
	isWhitespace,
	trimNewlinesFromEnd,
} from "./vim-text-navigation.ts";
import type { Operator } from "./vim-types.ts";

export const operators: Record<string, Operator> = {
	d: (text, { start, end }, motionChar) => {
		let actualEnd = Math.min(end, text.length);
		const actualStart = Math.min(start, actualEnd);

		// Don't delete newlines at the end of the range for motion-based deletions (de, d$, etc.)
		// But do delete newlines for line-based deletions (dd)
		if (motionChar !== "d") {
			actualEnd = trimNewlinesFromEnd(text, actualStart, actualEnd);
		}

		const newText = text.slice(0, actualStart) + text.slice(actualEnd);
		let newCursorPosition = actualStart;
		if (newText.length === 0) {
			newCursorPosition = 0;
		} else if (newCursorPosition >= newText.length) {
			newCursorPosition = newText.length - 1;
		}

		// Don't leave the cursor on a newline character (unless it's line deletion)
		// Also skip this if the cursor is on an empty line (newline is the only valid position)
		if (motionChar !== "d") {
			const cursorLineInfo = getLineInfo(newText, newCursorPosition);
			const cursorLine = getLineText(newText, cursorLineInfo.lineIndex);
			while (
				newCursorPosition > 0 &&
				isNewline(newText[newCursorPosition]) &&
				cursorLine.length > 0
			) {
				newCursorPosition--;
			}
		}

		return { newText, newCursorPosition };
	},
	c: (text, { start, end }, motionChar) => {
		let actualEnd = Math.min(end, text.length);
		const actualStart = Math.min(start, actualEnd);

		// For change operator with word motions (cw), trim trailing whitespace (like ce behavior in vim)
		if (motionChar === "w" || motionChar === "e") {
			let trimmedEnd = actualEnd;
			for (; trimmedEnd > actualStart; trimmedEnd--) {
				const char = text[trimmedEnd - 1];
				if (char === "\n" || char === "\r") {
					continue;
				}
				if (!isWhitespace(char)) break;
			}
			actualEnd = trimmedEnd;
		}

		const newText = text.slice(0, actualStart) + text.slice(actualEnd);
		let newCursorPosition = actualStart;
		if (newCursorPosition > newText.length) {
			newCursorPosition = newText.length;
		}
		return { newText, newCursorPosition, enterInsertMode: true };
	},
};
