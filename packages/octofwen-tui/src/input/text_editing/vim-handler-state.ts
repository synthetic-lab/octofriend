import type { PendingCommand, TextState, VimMode } from "./vim-types.ts";

export type VimHandlerState = {
	pendingCommand: PendingCommand | null;
	undoStack: TextState[];
	redoStack: TextState[];
	insertStartState: TextState | null;
};

export type VimHandlerActions = {
	saveState: (text: string, cursorPosition: number) => void;
	enterInsertMode: (text: string, cursorPosition: number) => void;
	setVimMode: (mode: VimMode) => void;
};

export type VimHandlerRuntime = VimHandlerState & VimHandlerActions;
