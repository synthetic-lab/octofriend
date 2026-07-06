import type {
	VimHandlerActions,
	VimHandlerState,
} from "./vim-handler-state.ts";
import { motions } from "./vim-motions.ts";
import { operators } from "./vim-operators.ts";
import {
	clampToVimBounds,
	getFirstNonWhitespacePosition,
	getLineEnd,
	getLineInfo,
	getLineInsertEnd,
	getLineStart,
	getLineText,
	getTargetPosition,
	isWhitespace,
	isWordChar,
	vimCommandResult,
	vimEarlyExit,
} from "./vim-text-navigation.ts";
import type { VimKeyHandlerResult } from "./vim-types.ts";

export type VimNormalCommandContext = {
	currentValue: string;
	cursorPosition: number;
	valueLength: number;
	state: VimHandlerState;
	actions: VimHandlerActions;
};

export function createNormalCommands({
	currentValue,
	cursorPosition,
	valueLength,
	state,
	actions,
}: VimNormalCommandContext): Record<string, () => VimKeyHandlerResult> {
	return {
		u: () => {
			if (state.undoStack.length === 0) return { consumed: true };
			const previousState = state.undoStack.pop();
			if (previousState === undefined) return { consumed: true };
			state.redoStack.push({ text: currentValue, cursorPosition });
			return {
				consumed: true,
				newValue: previousState.text,
				newCursorPosition: previousState.cursorPosition,
			};
		},
		i: () => {
			actions.enterInsertMode(currentValue, cursorPosition);
			return { consumed: true };
		},
		a: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const currentLine = getLineText(currentValue, currentLineInfo.lineIndex);

			if (currentLine.length === 0) {
				actions.enterInsertMode(currentValue, cursorPosition);
				return { consumed: true };
			}

			const newCursorPosition = Math.min(valueLength, cursorPosition + 1);
			actions.enterInsertMode(currentValue, cursorPosition);
			return { consumed: true, newCursorPosition };
		},
		h: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
			if (cursorPosition > lineStart) {
				return vimCommandResult(cursorPosition - 1, valueLength);
			}
			return vimCommandResult(cursorPosition, valueLength);
		},
		l: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const lineEnd = getLineEnd(currentValue, currentLineInfo.lineIndex);

			if (cursorPosition < lineEnd) {
				return vimCommandResult(cursorPosition + 1, valueLength);
			}
			return vimCommandResult(cursorPosition, valueLength);
		},
		k: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);

			if (currentLineInfo.lineIndex > 0) {
				const targetLineIndex = currentLineInfo.lineIndex - 1;
				const newCursorPosition = getTargetPosition(
					currentValue,
					targetLineIndex,
					currentLineInfo.columnIndex,
				);
				return vimCommandResult(newCursorPosition, valueLength);
			}

			return vimCommandResult(cursorPosition, valueLength);
		},
		j: () => {
			const lines = currentValue.split("\n");
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);

			if (currentLineInfo.lineIndex < lines.length - 1) {
				const targetLineIndex = currentLineInfo.lineIndex + 1;
				const newCursorPosition = getTargetPosition(
					currentValue,
					targetLineIndex,
					currentLineInfo.columnIndex,
				);
				return vimCommandResult(newCursorPosition, valueLength);
			}

			return vimCommandResult(cursorPosition, valueLength);
		},
		o: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const insertPosition = getLineStart(
				currentValue,
				currentLineInfo.lineIndex + 1,
			);
			actions.saveState(currentValue, cursorPosition);

			const newValue = [
				currentValue.slice(0, insertPosition),
				currentValue.slice(insertPosition),
			].join("\n");
			actions.enterInsertMode(currentValue, cursorPosition);

			return {
				consumed: true,
				newCursorPosition: insertPosition,
				newValue,
			};
		},
		O: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const insertPosition = getLineStart(
				currentValue,
				currentLineInfo.lineIndex,
			);
			actions.saveState(currentValue, cursorPosition);

			const newValue = [
				currentValue.slice(0, insertPosition),
				currentValue.slice(insertPosition),
			].join("\n");
			actions.enterInsertMode(currentValue, cursorPosition);

			return {
				consumed: true,
				newCursorPosition: insertPosition,
				newValue,
			};
		},
		x: () => {
			if (valueLength > 0) {
				actions.saveState(currentValue, cursorPosition);
				const beforeCursor = currentValue.slice(0, cursorPosition);
				const afterCursor = currentValue.slice(cursorPosition + 1);
				const newValue = beforeCursor + afterCursor;

				let newCursorPosition = cursorPosition;
				if (newValue.length === 0) {
					newCursorPosition = 0;
				} else if (cursorPosition >= newValue.length) {
					newCursorPosition = newValue.length - 1;
				}

				return { consumed: true, newValue, newCursorPosition };
			}
			return { consumed: true };
		},
		w: () => {
			const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
			if (earlyExit) return earlyExit;
			return vimCommandResult(
				motions.w(currentValue, cursorPosition).end,
				valueLength,
			);
		},
		W: () => {
			const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
			if (earlyExit) return earlyExit;
			return vimCommandResult(
				motions.W(currentValue, cursorPosition).end,
				valueLength,
			);
		},
		b: () => {
			const earlyExit = vimEarlyExit(cursorPosition === 0);
			if (earlyExit) return earlyExit;

			let wordStart = cursorPosition;

			while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
				wordStart--;
			}

			if (wordStart === 0) {
				return vimCommandResult(0, valueLength);
			}

			const firstNonWsChar = currentValue[wordStart - 1];
			const firstCharIsWord = isWordChar(firstNonWsChar);

			while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
				const currentChar = currentValue[wordStart - 1];
				const currentCharIsWord = isWordChar(currentChar);
				if (currentCharIsWord !== firstCharIsWord) {
					break;
				}
				wordStart--;
			}

			return vimCommandResult(wordStart, valueLength);
		},
		B: () => {
			const earlyExit = vimEarlyExit(cursorPosition === 0);
			if (earlyExit) return earlyExit;

			let wordStart = cursorPosition;

			while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
				wordStart--;
			}

			while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
				wordStart--;
			}

			return vimCommandResult(wordStart, valueLength);
		},
		e: () => {
			const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
			if (earlyExit) return earlyExit;
			const motion = motions.e(currentValue, cursorPosition);
			return vimCommandResult(motion.end - 1, valueLength);
		},
		"0": () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
			return { consumed: true, newCursorPosition: lineStart };
		},
		$: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const lineEnd = getLineEnd(currentValue, currentLineInfo.lineIndex);
			return { consumed: true, newCursorPosition: lineEnd };
		},
		"^": () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const position = getFirstNonWhitespacePosition(
				currentValue,
				currentLineInfo.lineIndex,
			);
			return { consumed: true, newCursorPosition: position };
		},
		I: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const position = getFirstNonWhitespacePosition(
				currentValue,
				currentLineInfo.lineIndex,
			);
			actions.enterInsertMode(currentValue, cursorPosition);
			return { consumed: true, newCursorPosition: position };
		},
		A: () => {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			actions.enterInsertMode(currentValue, cursorPosition);
			return {
				consumed: true,
				newCursorPosition: getLineInsertEnd(
					currentValue,
					currentLineInfo.lineIndex,
				),
			};
		},
		D: () => {
			actions.saveState(currentValue, cursorPosition);
			const range = motions["$"](currentValue, cursorPosition);
			const result = operators["d"](currentValue, range, "$");

			return {
				consumed: true,
				newValue: result.newText,
				newCursorPosition: clampToVimBounds(
					result.newCursorPosition ?? cursorPosition,
					result.newText.length,
				),
			};
		},
	};
}
