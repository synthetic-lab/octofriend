import chalk from "chalk";
import {
	Box,
	type DOMElement,
	type Key,
	measureElement,
	Text,
	useInput,
} from "ink";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import stringWidth from "string-width";
import {
	LINE_SPLIT_REGEX,
	wrapTextWithMapping,
} from "../../app/text_processing.ts";
import type { MultimodalConfig } from "../../internal/model-provider-catalog/main.ts";
import { type ImageInfo, parseImagePaths } from "../image_attachments.ts";
import { type EmacsKeyHandler, useEmacsKeyHandler } from "../text.ts";
import { useVimKeyHandler, type VimMode } from "./vim.tsx";

export function getImageBadgeText(index: number): string {
	return `⟦ 📎 Image Attachment #${index + 1} ⟧`;
}

export function getImageBadgeWidth(index: number): number {
	return stringWidth(getImageBadgeText(index)) + 1; // extra space for marginRight
}

const LOADING_BADGE_TEXT = "⟦ ⏳ Attaching image... ⟧";
const LOADING_BADGE_WIDTH = stringWidth(LOADING_BADGE_TEXT) + 1;

export type ImageBadgeLayoutItem = { index: number; isLoading: boolean };

export type ImageBadgeLayout = {
	badgeRows: ImageBadgeLayoutItem[][];
	remainingWidthForText: number;
};

export function computeImageBadgeLayout(
	imageCount: number,
	isLoading: boolean,
	containerWidth: number,
): ImageBadgeLayout {
	const badgeRows: ImageBadgeLayoutItem[][] = [];
	let currentRow: ImageBadgeLayoutItem[] = [];
	let currentRowWidth = 0;

	const totalItems = imageCount + (isLoading ? 1 : 0);

	for (let i = 0; i < totalItems; i++) {
		// only 1 loading badge will be shown at a time (sequential image loading)
		// the loading badge will be on the same row as the most recent image badge if it fits
		// otherwise on a new row
		const isCurrentLoading = isLoading && i === totalItems - 1;
		const currentBadgeWidth = isCurrentLoading
			? LOADING_BADGE_WIDTH
			: getImageBadgeWidth(i);

		if (
			currentRow.length > 0 &&
			currentRowWidth + currentBadgeWidth > containerWidth
		) {
			badgeRows.push(currentRow);
			currentRow = [{ index: i, isLoading: isCurrentLoading }];
			currentRowWidth = currentBadgeWidth;
		} else {
			currentRow.push({ index: i, isLoading: isCurrentLoading });
			currentRowWidth += currentBadgeWidth;
		}
	}

	let remainingWidthForText = containerWidth;

	if (currentRow.length > 0) {
		badgeRows.push(currentRow);
		remainingWidthForText = containerWidth - currentRowWidth;
	}

	return { badgeRows, remainingWidthForText };
}

export type TextInputProps = {
	readonly placeholder?: string;
	readonly focus?: boolean;
	readonly mask?: string;
	readonly showCursor?: boolean;
	readonly highlightPastedText?: boolean;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onImagePathsAttached?: (
		imagePaths: string[],
	) => void | Promise<void>;
	readonly onSubmit?: (value: string) => void;
	readonly showLoadingImageBadge?: boolean;
	readonly vimEnabled?: boolean;
	readonly vimMode?: VimMode;
	readonly setVimMode?: (mode: VimMode) => void;
	readonly attachedImages?: ImageInfo[];
	readonly onRemoveLastImage?: () => void;
	readonly modalities?: MultimodalConfig;
};

function ignoreVimModeChange(_mode: VimMode): void {
	return;
}

export function TextInput({
	attachedImages,
	value: originalValue,
	showLoadingImageBadge = false,
	placeholder = "",
	focus = true,
	mask,
	showCursor = true,
	onChange,
	onImagePathsAttached,
	onRemoveLastImage,
	onSubmit,
	vimEnabled = false,
	vimMode = "NORMAL",
	setVimMode,
	modalities,
}: TextInputProps) {
	const [state, setState] = useState({
		cursorOffset: 0,
		cursorWidth: 0,
	});
	const [isInitializing, setIsInitializing] = useState(true);
	const [measuredWidth, setMeasuredWidth] = useState(0);
	const containerRef = useRef<DOMElement>(null);

	const { cursorOffset, cursorWidth } = state;
	const valueRef = useRef(originalValue);
	const cursorOffsetRef = useRef(cursorOffset);
	const cursorWidthRef = useRef(cursorWidth);
	const renderCursorPosition = originalValue.length + cursorOffset;

	useEffect(() => {
		// useInput sets rawMode to true and then false on mount;
		const timer = setTimeout(() => setIsInitializing(false), 0);
		return () => clearTimeout(timer);
	}, []);

	function handleElementSize() {
		if (containerRef.current) {
			const dimensions = measureElement(containerRef.current);
			setMeasuredWidth(dimensions.width);
		}
	}

	// Measure container width on layout
	useLayoutEffect(() => {
		handleElementSize();
	});

	useEffect(() => {
		const handleResize = () => {
			setTimeout(handleElementSize, 0);
		};
		process.stdout.on("resize", handleResize);

		return () => {
			process.stdout.off("resize", handleResize);
		};
	}, []);

	useEffect(() => {
		valueRef.current = originalValue;
	}, [originalValue]);

	useEffect(() => {
		cursorOffsetRef.current = cursorOffset;
		cursorWidthRef.current = cursorWidth;
	}, [cursorOffset, cursorWidth]);

	// Create Vim handler
	const vimHandler = useVimKeyHandler(
		vimMode,
		setVimMode ?? ignoreVimModeChange,
	);

	// Create Emacs handler
	const emacsHandler = useEmacsKeyHandler();

	// Correct cursor position if dependencies change or text is shortened.
	useEffect(() => {
		setState((previousState) => {
			if (!(focus && showCursor)) {
				return previousState;
			}

			if (previousState.cursorOffset === 0) {
				return {
					cursorOffset: 0,
					cursorWidth: 0,
				};
			}

			return previousState;
		});
	}, [originalValue, focus, showCursor]);

	const renderModel = buildTextInputRenderModel({
		attachedImageCount: attachedImages?.length ?? 0,
		showLoadingImageBadge,
		measuredWidth,
		mask,
		originalValue,
		renderCursorPosition,
		placeholder,
		showCursor,
		focus,
	});

	useInput(
		(input, key) => {
			handleTextInputKey({
				input,
				key,
				isInitializing,
				valueRef,
				cursorOffsetRef,
				cursorWidthRef,
				attachedImages,
				onImagePathsAttached,
				onRemoveLastImage,
				onSubmit,
				modalities,
				vimEnabled,
				vimHandler,
				emacsHandler,
				showCursor,
				onChange,
				setState,
			});
		},
		{ isActive: focus },
	);

	return (
		<TextInputRows containerRef={containerRef} renderModel={renderModel} />
	);
}

type CursorState = {
	cursorOffset: number;
	cursorWidth: number;
};

type MutableRef<T> = { current: T };
type StateSetter<T> = (value: T) => void;
type VimInputHandler = ReturnType<typeof useVimKeyHandler>;

type TextInputKeyContext = {
	input: string;
	key: Key;
	isInitializing: boolean;
	valueRef: MutableRef<string>;
	cursorOffsetRef: MutableRef<number>;
	cursorWidthRef: MutableRef<number>;
	attachedImages?: ImageInfo[];
	onImagePathsAttached?: (imagePaths: string[]) => void | Promise<void>;
	onRemoveLastImage?: () => void;
	onSubmit?: (value: string) => void;
	modalities?: MultimodalConfig;
	vimEnabled: boolean;
	vimHandler: VimInputHandler;
	emacsHandler: EmacsKeyHandler;
	showCursor: boolean;
	onChange: (value: string) => void;
	setState: StateSetter<CursorState>;
};

function handleTextInputKey(context: TextInputKeyContext): void {
	if (context.isInitializing) return;
	if (context.key.ctrl && context.input === "p") return;
	const current = currentInputSnapshot(context);
	if (handlePastedImagePaths(context, current.currentValue)) return;
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
	const currentValue = context.valueRef.current;
	const previousCursorOffset = context.cursorOffsetRef.current;
	return {
		currentValue,
		previousCursorOffset,
		previousCursorWidth: context.cursorWidthRef.current,
		cursorPosition: currentValue.length + previousCursorOffset,
	};
}

function handlePastedImagePaths(
	context: TextInputKeyContext,
	currentValue: string,
): boolean {
	if (context.input.length <= 1) return false;
	const imagePaths = parseImagePaths(context.input);
	if (!(imagePaths && context.onImagePathsAttached)) return false;
	context.onImagePathsAttached(imagePaths);
	return (
		context.modalities?.image?.enabled === true && currentValue.length >= 0
	);
}

function handleVimInput(
	context: TextInputKeyContext,
	current: ReturnType<typeof currentInputSnapshot>,
): boolean {
	if (!context.vimEnabled) return false;
	const result = context.vimHandler.handle(
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
	current: ReturnType<typeof currentInputSnapshot>,
): boolean {
	const result = context.emacsHandler.handle(
		context.input,
		context.key,
		current.cursorPosition,
		current.currentValue.length,
		current.currentValue,
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
	if (result.newValue !== undefined) context.onChange(result.newValue);
	if (result.newCursorPosition === undefined) return;
	const valueLength = result.newValue?.length ?? currentValue.length;
	setCursorState(context, result.newCursorPosition - valueLength, 0);
}

function shouldIgnoreTextInputKey(input: string, key: Key): boolean {
	return Boolean(
		key.upArrow ||
			key.downArrow ||
			(key.ctrl && input === "c") ||
			key.tab ||
			(key.shift && key.tab),
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
	current: ReturnType<typeof currentInputSnapshot>,
): void {
	const next = nextPlainTextInputState(context, current);
	setCursorStateIfChanged(context, next, current);
	if (next.value !== current.currentValue) {
		context.valueRef.current = next.value;
		context.onChange(next.value);
	}
}

function nextPlainTextInputState(
	context: TextInputKeyContext,
	current: ReturnType<typeof currentInputSnapshot>,
): { value: string; cursorPosition: number; cursorWidth: number } {
	if (context.key.leftArrow) return moveCursorLeft(context, current);
	if (context.key.rightArrow) return moveCursorRight(context, current);
	if (context.key.backspace || context.key.delete) {
		return deleteBeforeCursor(context, current);
	}
	return insertInputAtCursor(context.input, current);
}

function moveCursorLeft(
	context: TextInputKeyContext,
	current: ReturnType<typeof currentInputSnapshot>,
) {
	return {
		value: current.currentValue,
		cursorPosition: context.showCursor
			? current.cursorPosition - 1
			: current.cursorPosition,
		cursorWidth: 0,
	};
}

function moveCursorRight(
	context: TextInputKeyContext,
	current: ReturnType<typeof currentInputSnapshot>,
) {
	return {
		value: current.currentValue,
		cursorPosition: context.showCursor
			? current.cursorPosition + 1
			: current.cursorPosition,
		cursorWidth: 0,
	};
}

function deleteBeforeCursor(
	context: TextInputKeyContext,
	current: ReturnType<typeof currentInputSnapshot>,
) {
	if (current.cursorPosition <= 0) {
		if (context.attachedImages && context.attachedImages.length > 0) {
			context.onRemoveLastImage?.();
		}
		return {
			value: current.currentValue,
			cursorPosition: current.cursorPosition,
			cursorWidth: 0,
		};
	}
	return {
		value:
			current.currentValue.slice(0, current.cursorPosition - 1) +
			current.currentValue.slice(current.cursorPosition),
		cursorPosition: current.cursorPosition - 1,
		cursorWidth: 0,
	};
}

function insertInputAtCursor(
	input: string,
	current: ReturnType<typeof currentInputSnapshot>,
) {
	return {
		value:
			current.currentValue.slice(0, current.cursorPosition) +
			input +
			current.currentValue.slice(current.cursorPosition),
		cursorPosition: current.cursorPosition + input.length,
		cursorWidth: input.length > 1 ? input.length : 0,
	};
}

function setCursorStateIfChanged(
	context: TextInputKeyContext,
	next: { value: string; cursorPosition: number; cursorWidth: number },
	current: ReturnType<typeof currentInputSnapshot>,
): void {
	const cursorPosition = clampCursorPosition(next.cursorPosition, next.value);
	const nextCursorOffset = cursorPosition - next.value.length;
	if (
		nextCursorOffset === current.previousCursorOffset &&
		next.cursorWidth === current.previousCursorWidth
	) {
		return;
	}
	setCursorState(context, nextCursorOffset, next.cursorWidth);
}

function setCursorState(
	context: TextInputKeyContext,
	cursorOffset: number,
	cursorWidth: number,
): void {
	context.cursorOffsetRef.current = cursorOffset;
	context.cursorWidthRef.current = cursorWidth;
	context.setState({ cursorOffset, cursorWidth });
}

function clampCursorPosition(cursorPosition: number, value: string): number {
	return Math.min(Math.max(cursorPosition, 0), value.length);
}

type TextInputRenderOptions = {
	attachedImageCount: number;
	showLoadingImageBadge: boolean;
	measuredWidth: number;
	mask: string | undefined;
	originalValue: string;
	renderCursorPosition: number;
	placeholder: string;
	showCursor: boolean;
	focus: boolean;
};

type TextInputRenderModel = {
	imageBadgeRows: ImageBadgeLayoutItem[][];
	lines: string[];
	textLinesToRender: string[];
	hasSharedRow: boolean;
};

function buildTextInputRenderModel(
	options: TextInputRenderOptions,
): TextInputRenderModel {
	const value = options.mask
		? options.mask.repeat(options.originalValue.length)
		: options.originalValue;
	const { badgeRows: imageBadgeRows, remainingWidthForText } =
		computeImageBadgeLayout(
			options.attachedImageCount,
			options.showLoadingImageBadge,
			options.measuredWidth,
		);
	const textStartsOnBadgeRow =
		imageBadgeRows.length > 0 && remainingWidthForText >= 5;
	const remainingWidthForFirstTextLine = textStartsOnBadgeRow
		? remainingWidthForText
		: undefined;
	const { wrapped, originalToWrapped } = wrapTextWithMapping(
		value,
		options.measuredWidth,
		remainingWidthForFirstTextLine,
	);
	const wrappedCursorPosition =
		originalToWrapped[options.renderCursorPosition] ??
		options.renderCursorPosition;
	const rendered = renderCursorText({
		wrapped,
		wrappedCursorPosition,
		placeholder: options.placeholder,
		showCursor: options.showCursor,
		focus: options.focus,
		value,
	});
	const lines = rendered.split(LINE_SPLIT_REGEX);
	const hasSharedRow = textStartsOnBadgeRow && imageBadgeRows.length > 0;
	return {
		imageBadgeRows,
		lines,
		textLinesToRender: hasSharedRow ? lines.slice(1) : lines,
		hasSharedRow,
	};
}

type CursorTextOptions = {
	wrapped: string;
	wrappedCursorPosition: number;
	placeholder: string;
	showCursor: boolean;
	focus: boolean;
	value: string;
};

function renderCursorText(options: CursorTextOptions): string {
	const renderedValue =
		options.showCursor && options.focus
			? renderValueWithCursor(options.wrapped, options.wrappedCursorPosition)
			: options.wrapped;
	if (!options.placeholder) return renderedValue || "";
	const renderedPlaceholder =
		options.showCursor && options.focus
			? renderPlaceholderWithCursor(options.placeholder)
			: chalk.grey(options.placeholder);
	return (options.value.length > 0 ? renderedValue : renderedPlaceholder) || "";
}

function renderPlaceholderWithCursor(placeholder: string): string {
	return placeholder.length > 0
		? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
		: chalk.inverse(" ");
}

function renderValueWithCursor(
	wrapped: string,
	wrappedCursorPosition: number,
): string {
	let renderedValue = wrapped.length > 0 ? "" : chalk.inverse(" ");
	const lines = wrapped.split(LINE_SPLIT_REGEX);
	let position = 0;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const result = renderCursorLine(
			lines[lineIndex],
			lineIndex,
			position,
			wrappedCursorPosition,
		);
		renderedValue += result.rendered;
		position = result.position;
		if (lineIndex < lines.length - 1) {
			renderedValue += "\n";
			position++;
		}
	}
	return renderedValue;
}

function renderCursorLine(
	line: string,
	lineIndex: number,
	startPosition: number,
	wrappedCursorPosition: number,
): { rendered: string; position: number } {
	let rendered = "";
	let position = startPosition;
	for (const char of line) {
		rendered += position === wrappedCursorPosition ? chalk.inverse(char) : char;
		position++;
	}
	if (
		shouldRenderTrailingCursor(line, lineIndex, position, wrappedCursorPosition)
	) {
		rendered += chalk.inverse(" ");
	}
	return { rendered, position };
}

function shouldRenderTrailingCursor(
	line: string,
	lineIndex: number,
	position: number,
	wrappedCursorPosition: number,
): boolean {
	return (
		position === wrappedCursorPosition &&
		!(lineIndex === 0 && line.length === 0 && wrappedCursorPosition === 0)
	);
}

function TextInputRows({
	containerRef,
	renderModel,
}: {
	containerRef: React.RefObject<DOMElement | null>;
	renderModel: TextInputRenderModel;
}) {
	return (
		<Box ref={containerRef} flexGrow={1} flexDirection="column">
			{renderModel.imageBadgeRows.map((imageBadgeItems, rowIndex) => (
				<ImageBadgeRow
					imageBadgeItems={imageBadgeItems}
					isSharedRow={
						renderModel.hasSharedRow &&
						rowIndex === renderModel.imageBadgeRows.length - 1
					}
					key={`badge-row-${rowIndex}`}
					sharedText={renderModel.lines[0]}
				/>
			))}
			{renderModel.textLinesToRender.map((line, index) => (
				<Box height={1} key={`text-line-${index}`}>
					<Text>{line}</Text>
				</Box>
			))}
		</Box>
	);
}

function ImageBadgeRow({
	imageBadgeItems,
	isSharedRow,
	sharedText,
}: {
	imageBadgeItems: ImageBadgeLayoutItem[];
	isSharedRow: boolean;
	sharedText: string;
}) {
	return (
		<Box flexDirection="row" height={1}>
			{imageBadgeItems.map((item) => (
				<Box key={`image-badge-${item.index}`} marginRight={1}>
					<Text inverse={true}>
						{item.isLoading
							? LOADING_BADGE_TEXT
							: getImageBadgeText(item.index)}
					</Text>
				</Box>
			))}
			{isSharedRow && <Text>{sharedText}</Text>}
		</Box>
	);
}
