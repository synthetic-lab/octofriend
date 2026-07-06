import type { Key } from "ink";
import type {
	VimHandlerActions,
	VimHandlerState,
} from "./vim-handler-state.ts";
import { createNormalCommands } from "./vim-normal-commands.ts";
import { operators } from "./vim-operators.ts";
import { handlePendingCommand } from "./vim-pending-command.ts";
import type { VimKeyHandlerResult } from "./vim-types.ts";

type NormalCommands = Record<string, () => VimKeyHandlerResult>;

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

function commandForKey(
	key: Key,
	commands: NormalCommands,
): (() => VimKeyHandlerResult) | null {
	if (key.ctrl && key.leftArrow) return commands["b"];
	if (key.ctrl && key.rightArrow) return commands["e"];
	if (key.leftArrow) return commands["h"];
	if (key.rightArrow) return commands["l"];
	if (key.upArrow) return commands["k"];
	if (key.downArrow) return commands["j"];
	if (key.home) return commands["0"];
	if (key.end) return commands["$"];
	return null;
}

export function handleNormalMode(
	input: string,
	key: Key,
	cursorPosition: number,
	valueLength: number,
	currentValue: string,
	state: VimHandlerState,
	actions: VimHandlerActions,
): VimKeyHandlerResult {
	if (key.return) return { consumed: false };

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

	const commands = createNormalCommands({
		currentValue,
		cursorPosition,
		valueLength,
		state,
		actions,
	});

	const keyCommand = commandForKey(key, commands);
	if (keyCommand) return keyCommand();

	if (input in commands) {
		return commands[input]();
	}

	return { consumed: true };
}
