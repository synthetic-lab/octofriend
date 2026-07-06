import type { Key } from "ink";

export type TextRange = { start: number; end: number };

export type Motion = (text: string, cursorPosition: number) => TextRange;

export type Operator = (
	text: string,
	range: TextRange,
	motionChar?: string,
) => {
	newText: string;
	newCursorPosition?: number;
	enterInsertMode?: boolean;
};

export type VimMode = "NORMAL" | "INSERT";

export type VimKeyHandlerResult = {
	consumed: boolean;
	newCursorPosition?: number;
	newValue?: string;
};

export type VimKeyHandler = {
	handle(
		input: string,
		key: Key,
		cursorPosition: number,
		valueLength: number,
		currentValue: string,
		vimMode: VimMode,
	): VimKeyHandlerResult;
};

export type PendingCommand = {
	operator: Operator;
	operatorChar: string;
};

export type TextState = {
	text: string;
	cursorPosition: number;
};
