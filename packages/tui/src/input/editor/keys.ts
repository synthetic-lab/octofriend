import type { Key } from "ink";
import type { MultimodalConfig } from "../../runtime/models/catalog/main";
import { type ImageInfo, parseImagePaths } from "../images";
import type { EmacsKeyHandler } from "./emacs-keys";
import {
	clampCursorPosition,
	nextPlainTextInputState,
	type TextInputEditResult,
	type TextInputSnapshot,
} from "./state";
import type { VimKeyHandlerResult } from "./vim";

type CursorState = {
	cursorOffset: number;
};

type MutableRef<T> = { current: T };
type StateSetter<T> = (value: T) => void;
type CurrentInputSnapshot = ReturnType<typeof currentInputSnapshot>;

type VimInputHandler = {
	handle(
		input: string,
		key: Key,
		cursorPosition: number,
		valueLength: number,
		currentValue: string,
	): VimKeyHandlerResult;
};

type TextInputKeyRefs = {
	valueRef: MutableRef<string>;
	cursorOffsetRef: MutableRef<number>;
};

type TextInputImageContext = {
	attachedImages?: ImageInfo[];
	onImagePathsAttached?: (imagePaths: string[]) => void | Promise<void>;
	onRemoveLastImage?: () => void;
	modalities?: MultimodalConfig;
};

type TextInputHandlerContext = {
	vimHandler: VimInputHandler;
	emacsHandler: EmacsKeyHandler;
};

export type TextInputKeyContext = {
	input: string;
	key: Key;
	refs: TextInputKeyRefs;
	images: TextInputImageContext;
	handlers: TextInputHandlerContext;
	onSubmit?: (value: string) => void;
	vimEnabled: boolean;
	showCursor: boolean;
	onChange: (value: string) => void;
	setState: StateSetter<CursorState>;
};

export function handleTextInputKey(context: TextInputKeyContext): void {
	if (context.key.ctrl && context.input === "p") return;
	const current = currentInputSnapshot(context);
	if (handlePastedImagePaths(context)) return;
	if (handleVimInput(context, current)) return;
	if (shouldIgnoreTextInputKey(context.input, context.key)) return;
	if (context.key.return) {
		submitTextInput(context, current.currentValue);
		return;
	}
	if (handleEmacsInput(context, current)) return;
	applyPlainTextInput(context, current);
}

function currentInputSnapshot(context: TextInputKeyContext) {
	const currentValue = context.refs.valueRef.current;
	const previousCursorOffset = context.refs.cursorOffsetRef.current;
	const valueLength = currentValue.length;
	return {
		currentValue,
		valueLength,
		previousCursorOffset,
		cursorPosition: clampCursorPosition(
			valueLength + previousCursorOffset,
			currentValue,
		),
	};
}

function handlePastedImagePaths(context: TextInputKeyContext): boolean {
	if (context.input.length <= 1) return false;
	if (context.images.modalities?.image?.enabled !== true) return false;
	const imagePaths = parseImagePaths(context.input);
	if (
		!(
			imagePaths &&
			imagePaths.length > 0 &&
			context.images.onImagePathsAttached
		)
	) {
		return false;
	}
	context.images.onImagePathsAttached(imagePaths);
	return true;
}

function handleVimInput(
	context: TextInputKeyContext,
	current: CurrentInputSnapshot,
): boolean {
	if (!context.vimEnabled) return false;
	const result = context.handlers.vimHandler.handle(
		context.input,
		context.key,
		current.cursorPosition,
		current.currentValue.length,
		current.currentValue,
	);
	if (!result.consumed) return false;
	applyHandlerResult(context, current.currentValue, result);
	return true;
}

function handleEmacsInput(
	context: TextInputKeyContext,
	current: CurrentInputSnapshot,
): boolean {
	const result = context.handlers.emacsHandler.handleSnapshot(
		context.input,
		context.key,
		current,
		context.showCursor,
	);
	if (!result.consumed) return false;
	applyHandlerResult(context, current.currentValue, result);
	return true;
}

function applyHandlerResult(
	context: TextInputKeyContext,
	currentValue: string,
	result: { newValue?: string; newCursorPosition?: number },
): void {
	if (result.newValue !== undefined) {
		context.refs.valueRef.current = result.newValue;
		context.onChange(result.newValue);
	}
	if (result.newCursorPosition === undefined) return;
	const valueLength = result.newValue?.length ?? currentValue.length;
	setCursorState(context, result.newCursorPosition - valueLength);
}

function shouldIgnoreTextInputKey(input: string, key: Key): boolean {
	const isSingleKeyTab =
		input.length <= 1 && (key.tab || (key.shift && key.tab));
	return Boolean(
		key.upArrow ||
			key.downArrow ||
			(key.ctrl && input === "c") ||
			isSingleKeyTab,
	);
}

function submitTextInput(
	context: TextInputKeyContext,
	currentValue: string,
): void {
	context.onSubmit?.(currentValue);
}

function applyPlainTextInput(
	context: TextInputKeyContext,
	current: TextInputSnapshot,
): void {
	const next = nextPlainTextInputState(
		{
			input: context.input,
			key: context.key,
			showCursor: context.showCursor,
			attachedImageCount: context.images.attachedImages?.length ?? 0,
		},
		current,
	);
	if (next.removeLastImage) context.images.onRemoveLastImage?.();
	setCursorStateIfChanged(context, next, current);
	if (next.value !== current.currentValue) {
		context.refs.valueRef.current = next.value;
		context.onChange(next.value);
	}
}

function setCursorStateIfChanged(
	context: TextInputKeyContext,
	next: TextInputEditResult,
	current: TextInputSnapshot,
): void {
	const cursorPosition = clampCursorPosition(next.cursorPosition, next.value);
	const nextCursorOffset = cursorPosition - next.value.length;
	if (nextCursorOffset === current.previousCursorOffset) {
		return;
	}
	setCursorState(context, nextCursorOffset);
}

function setCursorState(
	context: TextInputKeyContext,
	cursorOffset: number,
): void {
	if (context.refs.cursorOffsetRef.current === cursorOffset) return;
	context.refs.cursorOffsetRef.current = cursorOffset;
	context.setState({ cursorOffset });
}
