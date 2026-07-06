import type {
	VimHandlerActions,
	VimHandlerState,
} from "./vim-handler-state.ts";
import { handleInsertMode } from "./vim-insert-mode.ts";
import { handleNormalMode } from "./vim-normal-mode.ts";
import type {
	VimKeyHandler,
	VimKeyHandlerResult,
	VimMode,
} from "./vim-types.ts";

export function createVimKeyHandler(
	setVimMode: (mode: VimMode) => void,
): VimKeyHandler {
	const state: VimHandlerState = {
		pendingCommand: null,
		undoStack: [],
		redoStack: [],
		insertStartState: null,
	};

	const actions: VimHandlerActions = {
		saveState(text: string, cursorPosition: number) {
			state.undoStack.push({ text, cursorPosition });
			state.redoStack = [];
		},
		enterInsertMode(text: string, cursorPosition: number) {
			state.insertStartState = { text, cursorPosition };
			setVimMode("INSERT");
		},
		setVimMode,
	};

	return {
		handle(
			input,
			key,
			cursorPosition,
			valueLength,
			currentValue,
			vimMode,
		): VimKeyHandlerResult {
			if (vimMode === "INSERT") {
				return handleInsertMode(
					input,
					key,
					cursorPosition,
					currentValue,
					state,
					actions,
				);
			}

			return handleNormalMode(
				input,
				key,
				cursorPosition,
				valueLength,
				currentValue,
				state,
				actions,
			);
		},
	};
}
