import { motions } from "./vim-motions.ts";
import { clampToVimBounds, getLineRange } from "./vim-nav.ts";
import type { VimHandlerActions, VimHandlerState } from "./vim-state.ts";
import type { Operator, TextRange, VimKeyHandlerResult } from "./vim-types.ts";

type PendingOperatorResultInput = {
	operator: Operator;
	operatorChar: string;
	motionChar: string;
	range: TextRange;
	currentValue: string;
	cursorPosition: number;
	state: VimHandlerState;
	actions: VimHandlerActions;
};

function runPendingOperator({
	operator,
	motionChar,
	range,
	currentValue,
	cursorPosition,
	state,
	actions,
}: PendingOperatorResultInput): VimKeyHandlerResult {
	const result = operator(currentValue, range, motionChar);
	state.pendingCommand = null;

	let finalCursorPosition = result.newCursorPosition;
	if (finalCursorPosition !== undefined) {
		finalCursorPosition = clampToVimBounds(
			finalCursorPosition,
			result.newText.length,
		);
	}

	const response: VimKeyHandlerResult = {
		consumed: true,
		newValue: result.newText,
	};

	if (finalCursorPosition !== undefined) {
		response.newCursorPosition = finalCursorPosition;
	}

	if (result.enterInsertMode) {
		actions.enterInsertMode(currentValue, cursorPosition);
	} else {
		actions.saveState(currentValue, cursorPosition);
	}

	return response;
}

export function handlePendingCommand(
	input: string,
	currentValue: string,
	cursorPosition: number,
	state: VimHandlerState,
	actions: VimHandlerActions,
): VimKeyHandlerResult | null {
	const pending = state.pendingCommand;
	if (!pending) return null;

	if (input === pending.operatorChar) {
		return runPendingOperator({
			operator: pending.operator,
			operatorChar: pending.operatorChar,
			motionChar: input,
			range: getLineRange(currentValue, cursorPosition),
			currentValue,
			cursorPosition,
			state,
			actions,
		});
	}

	if (input in motions) {
		const motion = motions[input];
		return runPendingOperator({
			operator: pending.operator,
			operatorChar: pending.operatorChar,
			motionChar: input,
			range: motion(currentValue, cursorPosition),
			currentValue,
			cursorPosition,
			state,
			actions,
		});
	}

	state.pendingCommand = null;
	return null;
}
