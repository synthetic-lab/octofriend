import type { Key } from "ink";

export type EmacsKeyHandlerResult = {
	consumed: boolean;
	newCursorPosition?: number;
	newValue?: string;
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
};

type EmacsKeyContext = {
	input: string;
	key: Key;
	cursorPosition: number;
	valueLength: number;
	currentValue: string;
	showCursor: boolean;
};

type EmacsKeyBinding = {
	matches: (context: EmacsKeyContext) => boolean;
	apply: (context: EmacsKeyContext) => EmacsKeyHandlerResult;
};

const WHITESPACE_PATTERN = /\s/;

const isWhitespace = (char: string): boolean => WHITESPACE_PATTERN.test(char);

function previousWordStart(text: string, cursorPosition: number): number {
	let wordStart = cursorPosition;

	while (wordStart > 0 && isWhitespace(text[wordStart - 1])) {
		wordStart--;
	}

	while (wordStart > 0 && !isWhitespace(text[wordStart - 1])) {
		wordStart--;
	}

	return wordStart;
}

function nextWordEnd(
	text: string,
	cursorPosition: number,
	valueLength: number,
): number {
	let wordEnd = cursorPosition;

	while (wordEnd < valueLength && isWhitespace(text[wordEnd])) {
		wordEnd++;
	}

	while (wordEnd < valueLength && !isWhitespace(text[wordEnd])) {
		wordEnd++;
	}

	return wordEnd;
}

function binding(
	matches: EmacsKeyBinding["matches"],
	apply: EmacsKeyBinding["apply"],
): EmacsKeyBinding {
	return { matches, apply };
}

const EMACS_KEY_BINDINGS: readonly EmacsKeyBinding[] = [
	binding(
		({ input, key }) => (key.ctrl && input === "a") || key.home,
		() => ({ consumed: true, newCursorPosition: 0 }),
	),
	binding(
		({ input, key }) => (key.ctrl && input === "e") || key.end,
		({ valueLength }) => ({ consumed: true, newCursorPosition: valueLength }),
	),
	binding(
		({ input, key }) => key.ctrl && input === "b",
		({ cursorPosition, showCursor }) => {
			if (showCursor && cursorPosition > 0) {
				return { consumed: true, newCursorPosition: cursorPosition - 1 };
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) => key.ctrl && input === "f",
		({ cursorPosition, showCursor, valueLength }) => {
			if (showCursor && cursorPosition < valueLength) {
				return { consumed: true, newCursorPosition: cursorPosition + 1 };
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) =>
			(key.meta && input === "b") || (key.ctrl && key.leftArrow),
		({ cursorPosition, currentValue, showCursor }) => {
			if (showCursor && cursorPosition > 0) {
				return {
					consumed: true,
					newCursorPosition: previousWordStart(currentValue, cursorPosition),
				};
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) =>
			(key.meta && input === "f") || (key.ctrl && key.rightArrow),
		({ cursorPosition, currentValue, showCursor, valueLength }) => {
			if (showCursor && cursorPosition < valueLength) {
				return {
					consumed: true,
					newCursorPosition: nextWordEnd(
						currentValue,
						cursorPosition,
						valueLength,
					),
				};
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) => key.ctrl && input === "w",
		({ cursorPosition, currentValue }) => {
			if (cursorPosition > 0) {
				const wordStart = previousWordStart(currentValue, cursorPosition);
				const newValue =
					currentValue.slice(0, wordStart) + currentValue.slice(cursorPosition);
				return { consumed: true, newCursorPosition: wordStart, newValue };
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) => key.ctrl && input === "h",
		({ cursorPosition, currentValue }) => {
			if (cursorPosition > 0) {
				const newValue =
					currentValue.slice(0, cursorPosition - 1) +
					currentValue.slice(cursorPosition);
				return {
					consumed: true,
					newCursorPosition: cursorPosition - 1,
					newValue,
				};
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) => key.ctrl && input === "d",
		({ cursorPosition, currentValue, valueLength }) => {
			if (cursorPosition < valueLength) {
				const newValue =
					currentValue.slice(0, cursorPosition) +
					currentValue.slice(cursorPosition + 1);
				return { consumed: true, newValue };
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) => key.meta && input === "d",
		({ cursorPosition, currentValue, valueLength }) => {
			if (cursorPosition < valueLength) {
				const wordEnd = nextWordEnd(currentValue, cursorPosition, valueLength);
				const newValue =
					currentValue.slice(0, cursorPosition) + currentValue.slice(wordEnd);
				return { consumed: true, newValue };
			}
			return { consumed: true };
		},
	),
	binding(
		({ input, key }) => key.ctrl && input === "k",
		({ cursorPosition, currentValue }) => ({
			consumed: true,
			newValue: currentValue.slice(0, cursorPosition),
		}),
	),
	binding(
		({ input, key }) => key.ctrl && input === "u",
		({ cursorPosition, currentValue }) => ({
			consumed: true,
			newCursorPosition: 0,
			newValue: currentValue.slice(cursorPosition),
		}),
	),
];

export function useEmacsKeyHandler(): EmacsKeyHandler {
	return {
		handle(
			input: string,
			key: Key,
			cursorPosition: number,
			valueLength: number,
			currentValue: string,
			showCursor: boolean,
		): EmacsKeyHandlerResult {
			const context = {
				input,
				key,
				cursorPosition,
				valueLength,
				currentValue,
				showCursor,
			};

			const matchedBinding = EMACS_KEY_BINDINGS.find((candidate) =>
				candidate.matches(context),
			);
			return matchedBinding?.apply(context) ?? { consumed: false };
		},
	};
}

import {
	InputWithHistory,
	type InputWithHistoryProps,
	replaceSelectedMentions,
} from "./text_editing/input-with-history.tsx";
import {
	formatImageLoadError,
	getUnsupportedImageAttachmentsMessage,
	MultimediaInput,
	type MultimediaInputProps,
	shouldSubmitMultimediaInput,
} from "./text_editing/multimedia-input.tsx";
import {
	computeImageBadgeLayout,
	getImageBadgeText,
	getImageBadgeWidth,
	type ImageBadgeLayout,
	type ImageBadgeLayoutItem,
	TextInput,
	type TextInputProps,
} from "./text_editing/text-input.tsx";
import {
	createVimKeyHandler,
	useVimKeyHandler,
	type VimKeyHandler,
	type VimKeyHandlerResult,
	type VimMode,
	VimModeIndicator,
} from "./text_editing/vim.tsx";

export type {
	ImageBadgeLayout,
	ImageBadgeLayoutItem,
	InputWithHistoryProps,
	MultimediaInputProps,
	TextInputProps,
	VimKeyHandler,
	VimKeyHandlerResult,
	VimMode,
};
export {
	computeImageBadgeLayout,
	createVimKeyHandler,
	formatImageLoadError,
	getImageBadgeText,
	getImageBadgeWidth,
	getUnsupportedImageAttachmentsMessage,
	InputWithHistory,
	MultimediaInput,
	replaceSelectedMentions,
	shouldSubmitMultimediaInput,
	TextInput,
	useVimKeyHandler,
	VimModeIndicator,
};
