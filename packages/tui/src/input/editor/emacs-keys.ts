import type { Key } from "ink";
import { isWhitespaceCode } from "../../shell/text-characters.ts";
import { nextTextBoundary, previousTextBoundary } from "./boundaries.ts";

export type EmacsKeyHandlerResult = {
	consumed: boolean;
	newCursorPosition?: number;
	newValue?: string;
};

export type EmacsInputSnapshot = {
	cursorPosition: number;
	currentValue: string;
	valueLength: number;
};

export type EmacsKeyHandler = {
	handle(
		input: string,
		key: Key,
		cursorPosition: number,
		valueLength: number,
		currentValue: string,
		showCursor: boolean,
	): EmacsKeyHandlerResult;
	handleSnapshot(
		input: string,
		key: Key,
		current: EmacsInputSnapshot,
		showCursor: boolean,
	): EmacsKeyHandlerResult;
};

function isWhitespaceBoundary(
	text: string,
	start: number,
	end: number,
): boolean {
	if (start >= end) return false;
	return end === start + 1 && isWhitespaceCode(text.charCodeAt(start));
}

function scanWhitespaceBackward(text: string, position: number): number {
	let cursor = position;
	while (cursor > 0) {
		const previous = previousTextBoundary(text, cursor);
		if (!isWhitespaceBoundary(text, previous, cursor)) break;
		cursor = previous;
	}
	return cursor;
}

function scanNonWhitespaceBackward(text: string, position: number): number {
	let cursor = position;
	while (cursor > 0) {
		const previous = previousTextBoundary(text, cursor);
		if (isWhitespaceBoundary(text, previous, cursor)) break;
		cursor = previous;
	}
	return cursor;
}

function scanWhitespaceForward(
	text: string,
	position: number,
	valueLength: number,
): number {
	let cursor = position;
	while (cursor < valueLength) {
		const next = nextTextBoundary(text, cursor);
		if (!isWhitespaceBoundary(text, cursor, next)) break;
		cursor = next;
	}
	return cursor;
}

function scanNonWhitespaceForward(
	text: string,
	position: number,
	valueLength: number,
): number {
	let cursor = position;
	while (cursor < valueLength) {
		const next = nextTextBoundary(text, cursor);
		if (isWhitespaceBoundary(text, cursor, next)) break;
		cursor = next;
	}
	return cursor;
}

const consumed = (
	result: Omit<EmacsKeyHandlerResult, "consumed"> = {},
): EmacsKeyHandlerResult => ({ consumed: true, ...result });

const movePreviousCharacter = (
	current: EmacsInputSnapshot,
	showCursor: boolean,
): EmacsKeyHandlerResult => {
	const { currentValue, cursorPosition } = current;
	if (!(showCursor && cursorPosition > 0)) return consumed();
	return consumed({
		newCursorPosition: previousTextBoundary(currentValue, cursorPosition),
	});
};

const moveNextCharacter = (
	current: EmacsInputSnapshot,
	showCursor: boolean,
): EmacsKeyHandlerResult => {
	const { currentValue, cursorPosition, valueLength } = current;
	if (!(showCursor && cursorPosition < valueLength)) return consumed();
	return consumed({
		newCursorPosition: nextTextBoundary(currentValue, cursorPosition),
	});
};

const previousWordBoundary = ({
	currentValue,
	cursorPosition,
}: EmacsInputSnapshot): number =>
	scanNonWhitespaceBackward(
		currentValue,
		scanWhitespaceBackward(currentValue, cursorPosition),
	);

const nextWordBoundary = ({
	currentValue,
	cursorPosition,
	valueLength,
}: EmacsInputSnapshot): number =>
	scanNonWhitespaceForward(
		currentValue,
		scanWhitespaceForward(currentValue, cursorPosition, valueLength),
		valueLength,
	);

const movePreviousWord = (
	current: EmacsInputSnapshot,
	showCursor: boolean,
): EmacsKeyHandlerResult => {
	if (!(showCursor && current.cursorPosition > 0)) return consumed();
	return consumed({ newCursorPosition: previousWordBoundary(current) });
};

const moveNextWord = (
	current: EmacsInputSnapshot,
	showCursor: boolean,
): EmacsKeyHandlerResult => {
	if (!(showCursor && current.cursorPosition < current.valueLength)) {
		return consumed();
	}
	return consumed({ newCursorPosition: nextWordBoundary(current) });
};

const deletePreviousWord = (
	current: EmacsInputSnapshot,
): EmacsKeyHandlerResult => {
	const { currentValue, cursorPosition } = current;
	if (cursorPosition <= 0) return consumed();
	const wordStart = previousWordBoundary(current);
	return consumed({
		newCursorPosition: wordStart,
		newValue:
			currentValue.slice(0, wordStart) + currentValue.slice(cursorPosition),
	});
};

const deletePreviousCharacter = (
	current: EmacsInputSnapshot,
): EmacsKeyHandlerResult => {
	const { currentValue, cursorPosition } = current;
	if (cursorPosition <= 0) return consumed();
	const previous = previousTextBoundary(currentValue, cursorPosition);
	return consumed({
		newCursorPosition: previous,
		newValue:
			currentValue.slice(0, previous) + currentValue.slice(cursorPosition),
	});
};

const deleteNextCharacter = (
	current: EmacsInputSnapshot,
): EmacsKeyHandlerResult => {
	const { currentValue, cursorPosition, valueLength } = current;
	if (cursorPosition >= valueLength) return consumed();
	const next = nextTextBoundary(currentValue, cursorPosition);
	return consumed({
		newValue: currentValue.slice(0, cursorPosition) + currentValue.slice(next),
	});
};

const deleteNextWord = (current: EmacsInputSnapshot): EmacsKeyHandlerResult => {
	const { currentValue, cursorPosition, valueLength } = current;
	if (cursorPosition >= valueLength) return consumed();
	const wordEnd = nextWordBoundary(current);
	return consumed({
		newValue:
			currentValue.slice(0, cursorPosition) + currentValue.slice(wordEnd),
	});
};

const deleteToEnd = ({
	currentValue,
	cursorPosition,
}: EmacsInputSnapshot): EmacsKeyHandlerResult =>
	consumed({ newValue: currentValue.slice(0, cursorPosition) });

const deleteToStart = ({
	currentValue,
	cursorPosition,
}: EmacsInputSnapshot): EmacsKeyHandlerResult =>
	consumed({
		newCursorPosition: 0,
		newValue: currentValue.slice(cursorPosition),
	});

type EmacsCommandHandler = (
	current: EmacsInputSnapshot,
	showCursor: boolean,
) => EmacsKeyHandlerResult;

const CONTROL_COMMANDS: Partial<Record<string, EmacsCommandHandler>> = {
	a: () => consumed({ newCursorPosition: 0 }),
	b: movePreviousCharacter,
	d: deleteNextCharacter,
	e: ({ valueLength }) => consumed({ newCursorPosition: valueLength }),
	f: moveNextCharacter,
	h: deletePreviousCharacter,
	k: deleteToEnd,
	u: deleteToStart,
	w: deletePreviousWord,
};

const META_COMMANDS: Partial<Record<string, EmacsCommandHandler>> = {
	b: movePreviousWord,
	d: deleteNextWord,
	f: moveNextWord,
};

function handleEmacsKey(
	input: string,
	key: Key,
	current: EmacsInputSnapshot,
	showCursor: boolean,
): EmacsKeyHandlerResult {
	if (key.home) {
		return consumed({ newCursorPosition: 0 });
	}
	if (key.end) {
		return consumed({ newCursorPosition: current.valueLength });
	}
	if (key.ctrl && key.leftArrow) {
		return movePreviousWord(current, showCursor);
	}
	if (key.ctrl && key.rightArrow) {
		return moveNextWord(current, showCursor);
	}
	const command = key.ctrl
		? CONTROL_COMMANDS[input]
		: key.meta
			? META_COMMANDS[input]
			: undefined;
	return command?.(current, showCursor) ?? { consumed: false };
}

export function useEmacsKeyHandler(): EmacsKeyHandler {
	return {
		handle(input, key, cursorPosition, _valueLength, currentValue, showCursor) {
			return handleEmacsKey(
				input,
				key,
				{ cursorPosition, currentValue, valueLength: _valueLength },
				showCursor,
			);
		},
		handleSnapshot: handleEmacsKey,
	};
}
