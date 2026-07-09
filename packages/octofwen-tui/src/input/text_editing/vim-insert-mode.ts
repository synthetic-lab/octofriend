import type { Key } from "ink";
import { previousTextBoundary } from "./text-boundaries.ts";
import type { VimHandlerRuntime } from "./vim-handler-state.ts";
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
	runtime: VimHandlerRuntime,
): VimKeyHandlerResult {
	if (key.escape || (key.ctrl && input === "c")) {
		let newCursorPosition = cursorPosition;
		if (cursorPosition > 0) {
			const currentLineInfo = getLineInfo(currentValue, cursorPosition);
			const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
			const currentLine = getLineText(currentValue, currentLineInfo.lineIndex);
			if (!(cursorPosition === lineStart && currentLine.length === 0)) {
				newCursorPosition = previousTextBoundary(currentValue, cursorPosition);
			}
		}
		if (runtime.insertStartState !== null) {
			runtime.saveState(
				runtime.insertStartState.text,
				runtime.insertStartState.cursorPosition,
			);
			runtime.insertStartState = null;
		}
		runtime.setVimMode("NORMAL");
		return { consumed: true, newCursorPosition };
	}

	if (runtime.insertStartState === null) {
		runtime.insertStartState = { text: currentValue, cursorPosition };
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
