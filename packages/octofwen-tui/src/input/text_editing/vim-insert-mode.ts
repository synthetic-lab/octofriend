import type { Key } from "ink";
import type {
	VimHandlerActions,
	VimHandlerState,
} from "./vim-handler-state.ts";
import {
	getLineInfo,
	getLineStart,
	getLineText,
} from "./vim-text-navigation.ts";
import type { VimKeyHandlerResult } from "./vim-types.ts";

export function handleInsertMode(
	input: string,
	key: Key,
	cursorPosition: number,
	currentValue: string,
	state: VimHandlerState,
	actions: VimHandlerActions,
): VimKeyHandlerResult {
	if (key.escape || (key.ctrl && input === "c")) {
		let newCursorPosition = cursorPosition;
		if (cursorPosition > 0) {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
			const currentLine = getLineText(currentValue, currentLineInfo.lineIndex);
			if (!(cursorPosition === lineStart && currentLine.length === 0)) {
				newCursorPosition = cursorPosition - 1;
			}
		}
		if (state.insertStartState !== null) {
			actions.saveState(
				state.insertStartState.text,
				state.insertStartState.cursorPosition,
			);
			state.insertStartState = null;
		}
		actions.setVimMode("NORMAL");
		return { consumed: true, newCursorPosition };
	}

	if (state.insertStartState === null) {
		state.insertStartState = { text: currentValue, cursorPosition };
	}

	if (key.return) {
		return {
			consumed: true,
			newValue:
				currentValue.slice(0, cursorPosition) +
				"\n" +
				currentValue.slice(cursorPosition),
		};
	}

	return { consumed: false };
}
