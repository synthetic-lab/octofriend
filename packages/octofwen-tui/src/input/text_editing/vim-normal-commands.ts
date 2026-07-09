import { nextTextBoundary, previousTextBoundary } from "./text-boundaries.ts";
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
	hasLineAfter,
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

type NormalCommandRunner = (
	context: VimNormalCommandContext,
) => VimKeyHandlerResult;

function backMotionResult(
	currentValue: string,
	cursorPosition: number,
	valueLength: number,
	motion: "b" | "B",
): VimKeyHandlerResult {
	const earlyExit = vimEarlyExit(cursorPosition === 0);
	if (earlyExit) return earlyExit;
	return vimCommandResult(
		motions[motion](currentValue, cursorPosition).start,
		valueLength,
	);
}

const NORMAL_COMMANDS: Record<string, NormalCommandRunner> = {
	u: ({ currentValue, cursorPosition, state }) => {
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
	i: ({ currentValue, cursorPosition, actions }) => {
		actions.enterInsertMode(currentValue, cursorPosition);
		return { consumed: true };
	},
	a: ({ currentValue, cursorPosition, actions }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const currentLine = getLineText(currentValue, currentLineInfo.lineIndex);

		if (currentLine.length === 0) {
			actions.enterInsertMode(currentValue, cursorPosition);
			return { consumed: true };
		}

		const newCursorPosition = nextTextBoundary(currentValue, cursorPosition);
		actions.enterInsertMode(currentValue, cursorPosition);
		return { consumed: true, newCursorPosition };
	},
	h: ({ currentValue, cursorPosition, valueLength }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
		if (cursorPosition > lineStart) {
			return vimCommandResult(
				previousTextBoundary(currentValue, cursorPosition),
				valueLength,
			);
		}
		return vimCommandResult(cursorPosition, valueLength);
	},
	l: ({ currentValue, cursorPosition, valueLength }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const lineEnd = getLineEnd(currentValue, currentLineInfo.lineIndex);

		if (cursorPosition < lineEnd) {
			return vimCommandResult(
				nextTextBoundary(currentValue, cursorPosition),
				valueLength,
			);
		}
		return vimCommandResult(cursorPosition, valueLength);
	},
	k: ({ currentValue, cursorPosition, valueLength }) => {
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
	j: ({ currentValue, cursorPosition, valueLength }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);

		if (hasLineAfter(currentValue, currentLineInfo.lineIndex)) {
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
	o: ({ currentValue, cursorPosition, actions }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const insertPosition = getLineStart(
			currentValue,
			currentLineInfo.lineIndex + 1,
		);
		actions.saveState(currentValue, cursorPosition);

		const newValue =
			currentValue.slice(0, insertPosition) +
			"\n" +
			currentValue.slice(insertPosition);
		actions.enterInsertMode(currentValue, cursorPosition);

		return {
			consumed: true,
			newCursorPosition: insertPosition,
			newValue,
		};
	},
	O: ({ currentValue, cursorPosition, actions }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const insertPosition = getLineStart(
			currentValue,
			currentLineInfo.lineIndex,
		);
		actions.saveState(currentValue, cursorPosition);

		const newValue =
			currentValue.slice(0, insertPosition) +
			"\n" +
			currentValue.slice(insertPosition);
		actions.enterInsertMode(currentValue, cursorPosition);

		return {
			consumed: true,
			newCursorPosition: insertPosition,
			newValue,
		};
	},
	x: ({ currentValue, cursorPosition, valueLength, actions }) => {
		if (valueLength > 0) {
			actions.saveState(currentValue, cursorPosition);
			const deleteEnd = nextTextBoundary(currentValue, cursorPosition);
			const beforeCursor = currentValue.slice(0, cursorPosition);
			const afterCursor = currentValue.slice(deleteEnd);
			const newValue = beforeCursor + afterCursor;

			let newCursorPosition = cursorPosition;
			if (newValue.length === 0) {
				newCursorPosition = 0;
			} else if (cursorPosition >= newValue.length) {
				newCursorPosition = previousTextBoundary(newValue, newValue.length);
			}

			return { consumed: true, newValue, newCursorPosition };
		}
		return { consumed: true };
	},
	w: ({ currentValue, cursorPosition, valueLength }) => {
		const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
		if (earlyExit) return earlyExit;
		return vimCommandResult(
			motions.w(currentValue, cursorPosition).end,
			valueLength,
		);
	},
	W: ({ currentValue, cursorPosition, valueLength }) => {
		const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
		if (earlyExit) return earlyExit;
		return vimCommandResult(
			motions.W(currentValue, cursorPosition).end,
			valueLength,
		);
	},
	b: ({ currentValue, cursorPosition, valueLength }) =>
		backMotionResult(currentValue, cursorPosition, valueLength, "b"),
	B: ({ currentValue, cursorPosition, valueLength }) =>
		backMotionResult(currentValue, cursorPosition, valueLength, "B"),
	e: ({ currentValue, cursorPosition, valueLength }) => {
		const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
		if (earlyExit) return earlyExit;
		const motion = motions.e(currentValue, cursorPosition);
		return vimCommandResult(
			previousTextBoundary(currentValue, motion.end),
			valueLength,
		);
	},
	"0": ({ currentValue, cursorPosition }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
		return { consumed: true, newCursorPosition: lineStart };
	},
	$: ({ currentValue, cursorPosition }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const lineEnd = getLineEnd(currentValue, currentLineInfo.lineIndex);
		return { consumed: true, newCursorPosition: lineEnd };
	},
	"^": ({ currentValue, cursorPosition }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const position = getFirstNonWhitespacePosition(
			currentValue,
			currentLineInfo.lineIndex,
		);
		return { consumed: true, newCursorPosition: position };
	},
	I: ({ currentValue, cursorPosition, actions }) => {
		const currentLineInfo = getLineInfo(currentValue, cursorPosition);
		const position = getFirstNonWhitespacePosition(
			currentValue,
			currentLineInfo.lineIndex,
		);
		actions.enterInsertMode(currentValue, cursorPosition);
		return { consumed: true, newCursorPosition: position };
	},
	A: ({ currentValue, cursorPosition, actions }) => {
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
	D: ({ currentValue, cursorPosition, actions }) => {
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

export function runNormalCommand(
	input: string,
	context: VimNormalCommandContext,
): VimKeyHandlerResult | null {
	const command = NORMAL_COMMANDS[input];
	return command === undefined ? null : command(context);
}
