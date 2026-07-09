import type { Key } from "ink";
import type { VimHandlerState } from "./vim-state";
import {
	runNormalCommand,
	type VimNormalCommandContext,
} from "./vim-commands";
import { operators } from "./vim-operators";
import { handlePendingCommand } from "./vim-pending";
import type { VimKeyHandlerResult } from "./vim-types";

function handleRedo(
	currentValue: string,
	cursorPosition: number,
	state: VimHandlerState,
): VimKeyHandlerResult {
	if (state.redoStack.length === 0) return { consumed: true };
	const nextState = state.redoStack.pop();
	if (nextState === undefined) return { consumed: true };
	state.undoStack.push({ text: currentValue, cursorPosition });
	return {
		consumed: true,
		newValue: nextState.text,
		newCursorPosition: nextState.cursorPosition,
	};
}

function commandInputForKey(key: Key): string | null {
	if (key.ctrl && key.leftArrow) return "b";
	if (key.ctrl && key.rightArrow) return "e";
	if (key.leftArrow) return "h";
	if (key.rightArrow) return "l";
	if (key.upArrow) return "k";
	if (key.downArrow) return "j";
	if (key.home) return "0";
	if (key.end) return "$";
	return null;
}

export function handleNormalMode(
	input: string,
	key: Key,
	context: VimNormalCommandContext,
): VimKeyHandlerResult {
	if (key.return) return { consumed: false };
	const { currentValue, cursorPosition, state, actions } = context;

	const pendingResult = handlePendingCommand(
		input,
		currentValue,
		cursorPosition,
		state,
		actions,
	);
	if (pendingResult) return pendingResult;

	if (key.ctrl && input === "r") {
		return handleRedo(currentValue, cursorPosition, state);
	}

	if (input in operators) {
		state.pendingCommand = {
			operator: operators[input],
			operatorChar: input,
		};
		return { consumed: true };
	}

	const keyCommandInput = commandInputForKey(key);
	if (keyCommandInput) {
		const result = runNormalCommand(keyCommandInput, context);
		if (result) return result;
	}

	const result = runNormalCommand(input, context);
	if (result) return result;

	return { consumed: true };
}
