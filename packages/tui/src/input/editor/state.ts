import { nextTextBoundary, previousTextBoundary } from "./boundaries";

export type TextInputSnapshot = {
	currentValue: string;
	previousCursorOffset: number;
	cursorPosition: number;
};

export type TextInputEditKey = {
	leftArrow?: boolean;
	rightArrow?: boolean;
	backspace?: boolean;
	delete?: boolean;
};

export type TextInputEditOptions = {
	input: string;
	key: TextInputEditKey;
	showCursor: boolean;
	attachedImageCount: number;
};

export type TextInputEditResult = {
	value: string;
	cursorPosition: number;
	removeLastImage: boolean;
};

export function nextPlainTextInputState(
	options: TextInputEditOptions,
	current: TextInputSnapshot,
): TextInputEditResult {
	const normalizedCurrent = normalizedTextInputSnapshot(current);
	if (options.key.leftArrow) return moveCursorLeft(options, normalizedCurrent);
	if (options.key.rightArrow)
		return moveCursorRight(options, normalizedCurrent);
	if (options.key.backspace)
		return deleteBeforeCursor(options, normalizedCurrent);
	if (options.key.delete) return deleteAfterCursor(normalizedCurrent);
	return insertInputAtCursor(
		normalizePastedLineEndings(options.input),
		normalizedCurrent,
	);
}

export function normalizePastedLineEndings(input: string): string {
	const firstCarriageReturn = input.indexOf("\r");
	if (firstCarriageReturn === -1) return input;
	const parts: string[] = [];
	let segmentStart = 0;
	for (
		let readIndex = firstCarriageReturn;
		readIndex < input.length;
		readIndex += 1
	) {
		if (input.charCodeAt(readIndex) !== 13) continue;
		if (segmentStart < readIndex) {
			parts[parts.length] = input.slice(segmentStart, readIndex);
		}
		parts[parts.length] = "\n";
		if (input.charCodeAt(readIndex + 1) === 10) readIndex += 1;
		segmentStart = readIndex + 1;
	}
	if (segmentStart < input.length) {
		parts[parts.length] = input.slice(segmentStart);
	}
	return parts.join("");
}

export function clampCursorPosition(
	cursorPosition: number,
	value: string,
): number {
	const clamped = Math.min(Math.max(cursorPosition, 0), value.length);
	if (clamped === 0 || clamped === value.length) return clamped;
	const previousBoundary = previousTextBoundary(value, clamped);
	return nextTextBoundary(value, previousBoundary) === clamped
		? clamped
		: previousBoundary;
}

function normalizedTextInputSnapshot(
	current: TextInputSnapshot,
): TextInputSnapshot {
	const cursorPosition = clampCursorPosition(
		current.cursorPosition,
		current.currentValue,
	);
	if (cursorPosition === current.cursorPosition) return current;
	return { ...current, cursorPosition };
}

function unchangedResult(
	current: TextInputSnapshot,
	removeLastImage = false,
): TextInputEditResult {
	return {
		value: current.currentValue,
		cursorPosition: current.cursorPosition,
		removeLastImage,
	};
}

function moveCursorLeft(
	options: TextInputEditOptions,
	current: TextInputSnapshot,
): TextInputEditResult {
	if (!options.showCursor) return unchangedResult(current);
	return {
		value: current.currentValue,
		cursorPosition: previousTextBoundary(
			current.currentValue,
			current.cursorPosition,
		),
		removeLastImage: false,
	};
}

function moveCursorRight(
	options: TextInputEditOptions,
	current: TextInputSnapshot,
): TextInputEditResult {
	if (!options.showCursor) return unchangedResult(current);
	return {
		value: current.currentValue,
		cursorPosition: nextTextBoundary(
			current.currentValue,
			current.cursorPosition,
		),
		removeLastImage: false,
	};
}

function deleteBeforeCursor(
	options: TextInputEditOptions,
	current: TextInputSnapshot,
): TextInputEditResult {
	if (current.cursorPosition <= 0) {
		return unchangedResult(current, options.attachedImageCount > 0);
	}
	const deleteFrom = previousTextBoundary(
		current.currentValue,
		current.cursorPosition,
	);
	return {
		value:
			current.currentValue.slice(0, deleteFrom) +
			current.currentValue.slice(current.cursorPosition),
		cursorPosition: deleteFrom,
		removeLastImage: false,
	};
}

function deleteAfterCursor(current: TextInputSnapshot): TextInputEditResult {
	if (current.cursorPosition >= current.currentValue.length) {
		return unchangedResult(current);
	}
	const deleteTo = nextTextBoundary(
		current.currentValue,
		current.cursorPosition,
	);
	return {
		value:
			current.currentValue.slice(0, current.cursorPosition) +
			current.currentValue.slice(deleteTo),
		cursorPosition: current.cursorPosition,
		removeLastImage: false,
	};
}

function insertInputAtCursor(
	input: string,
	current: TextInputSnapshot,
): TextInputEditResult {
	if (input.length === 0) return unchangedResult(current);
	const value = current.currentValue;
	const cursorPosition = current.cursorPosition + input.length;
	if (current.cursorPosition === value.length) {
		return {
			value: value + input,
			cursorPosition,
			removeLastImage: false,
		};
	}
	if (current.cursorPosition === 0) {
		return {
			value: input + value,
			cursorPosition,
			removeLastImage: false,
		};
	}
	return {
		value:
			value.slice(0, current.cursorPosition) +
			input +
			value.slice(current.cursorPosition),
		cursorPosition,
		removeLastImage: false,
	};
}
