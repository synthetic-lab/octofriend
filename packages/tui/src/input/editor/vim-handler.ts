import { handleInsertMode } from "./vim-insert.ts";
import { handleNormalMode } from "./vim-normal.ts";
import type { VimHandlerRuntime } from "./vim-state.ts";
import type {
	VimKeyHandler,
	VimKeyHandlerResult,
	VimMode,
} from "./vim-types.ts";

export function createVimKeyHandler(
	setVimMode: (mode: VimMode) => void,
): VimKeyHandler {
	const runtime: VimHandlerRuntime = {
		pendingCommand: null,
		undoStack: [],
		redoStack: [],
		insertStartState: null,
		saveState(text: string, cursorPosition: number) {
			runtime.undoStack.push({ text, cursorPosition });
			runtime.redoStack.length = 0;
		},
		enterInsertMode(text: string, cursorPosition: number) {
			runtime.insertStartState = { text, cursorPosition };
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
					runtime,
				);
			}

			return handleNormalMode(input, key, {
				currentValue,
				cursorPosition,
				valueLength,
				state: runtime,
				actions: runtime,
			});
		},
	};
}
