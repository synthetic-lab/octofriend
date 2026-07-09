import { type DOMElement, type Key, measureElement } from "ink";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { MultimodalConfig } from "../../runtime/models/catalog/main";
import { useStdoutResize } from "../../layout/stdout-resize";
import { useTerminalContentWidth } from "../../layout/viewport";
import type { ImageInfo } from "../images";
import { useLatestInput, useLatestRef } from "../latest-input";
import { useEmacsKeyHandler } from "./emacs-keys";
import { handleTextInputKey } from "./keys";
import {
	buildTextInputRenderModel,
	TextInputRows,
} from "./render";
import { clampCursorPosition } from "./state";
import { useVimKeyHandler, type VimMode } from "./vim";

const FALLBACK_TEXT_INPUT_WIDTH = 80;

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

export function initialTextInputMeasuredWidth(
	terminalWidth: number | undefined,
): number {
	return terminalWidth && terminalWidth > 0
		? terminalWidth
		: FALLBACK_TEXT_INPUT_WIDTH;
}

export function nextTextInputMeasuredWidth(
	previousWidth: number,
	measuredWidth: number,
	terminalWidth = Number.POSITIVE_INFINITY,
): number {
	const boundedPrevious =
		terminalWidth > 0 ? Math.min(previousWidth, terminalWidth) : previousWidth;
	if (measuredWidth <= 0) return boundedPrevious;
	const boundedMeasured =
		terminalWidth > 0 ? Math.min(measuredWidth, terminalWidth) : measuredWidth;
	if (boundedMeasured < boundedPrevious) return boundedPrevious;
	return boundedPrevious === boundedMeasured
		? boundedPrevious
		: boundedMeasured;
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
	});
	const terminalWidth = useTerminalContentWidth();
	const [measuredWidth, setMeasuredWidth] = useState(() =>
		initialTextInputMeasuredWidth(terminalWidth),
	);
	const measuredWidthRef = useRef(measuredWidth);
	const containerRef = useRef<DOMElement>(null);

	const { cursorOffset } = state;
	const valueRef = useLatestRef(originalValue);
	const cursorOffsetRef = useLatestRef(cursorOffset);
	const renderCursorPosition = originalValue.length + cursorOffset;

	const updateMeasuredWidth = useCallback(() => {
		if (!containerRef.current) return;
		const dimensions = measureElement(containerRef.current);
		const nextWidth = nextTextInputMeasuredWidth(
			measuredWidthRef.current,
			dimensions.width,
			terminalWidth,
		);
		if (nextWidth === measuredWidthRef.current) return;
		measuredWidthRef.current = nextWidth;
		setMeasuredWidth(nextWidth);
	}, [terminalWidth]);

	// Measure once after mount; terminal resize path remeasures later.
	useLayoutEffect(() => {
		updateMeasuredWidth();
	}, [updateMeasuredWidth]);

	useStdoutResize(updateMeasuredWidth);

	// Create Vim handler
	const vimHandler = useVimKeyHandler(
		vimMode,
		setVimMode ?? ignoreVimModeChange,
	);

	// Create Emacs handler
	const emacsHandler = useEmacsKeyHandler();
	const attachedImagesRef = useLatestRef(attachedImages);
	const emacsHandlerRef = useLatestRef(emacsHandler);
	const modalitiesRef = useLatestRef(modalities);
	const onChangeRef = useLatestRef(onChange);
	const onImagePathsAttachedRef = useLatestRef(onImagePathsAttached);
	const onRemoveLastImageRef = useLatestRef(onRemoveLastImage);
	const onSubmitRef = useLatestRef(onSubmit);
	const showCursorRef = useLatestRef(showCursor);
	const vimEnabledRef = useLatestRef(vimEnabled);
	const vimHandlerRef = useLatestRef(vimHandler);

	// Correct cursor position if dependencies change or text is shortened.
	useEffect(() => {
		setState((previousState) => {
			if (!(focus && showCursor)) return previousState;

			const cursorPosition = clampCursorPosition(
				originalValue.length + previousState.cursorOffset,
				originalValue,
			);
			const cursorOffset = cursorPosition - originalValue.length;
			if (cursorOffset === previousState.cursorOffset) return previousState;
			cursorOffsetRef.current = cursorOffset;
			return { cursorOffset };
		});
	}, [originalValue, focus, showCursor]);

	const renderWidth = Math.min(measuredWidth, terminalWidth);

	const renderModel = useMemo(
		() =>
			buildTextInputRenderModel({
				attachedImageCount: attachedImages?.length ?? 0,
				showLoadingImageBadge,
				measuredWidth: renderWidth,
				mask,
				originalValue,
				renderCursorPosition,
				placeholder,
				showCursor,
				focus,
			}),
		[
			attachedImages?.length,
			focus,
			mask,
			renderWidth,
			originalValue,
			placeholder,
			renderCursorPosition,
			showCursor,
			showLoadingImageBadge,
		],
	);

	const handleInput = useCallback(
		(input: string, key: Key) => {
			handleTextInputKey({
				input,
				key,
				refs: {
					valueRef,
					cursorOffsetRef,
				},
				images: {
					attachedImages: attachedImagesRef.current,
					onImagePathsAttached: onImagePathsAttachedRef.current,
					onRemoveLastImage: onRemoveLastImageRef.current,
					modalities: modalitiesRef.current,
				},
				handlers: {
					vimHandler: vimHandlerRef.current,
					emacsHandler: emacsHandlerRef.current,
				},
				vimEnabled: vimEnabledRef.current,
				onSubmit: onSubmitRef.current,
				showCursor: showCursorRef.current,
				onChange: onChangeRef.current,
				setState,
			});
		},
		[
			attachedImagesRef,
			emacsHandlerRef,
			modalitiesRef,
			onChangeRef,
			onImagePathsAttachedRef,
			onRemoveLastImageRef,
			onSubmitRef,
			showCursorRef,
			vimEnabledRef,
			vimHandlerRef,
		],
	);

	const inputOptions = useMemo(() => ({ isActive: focus }), [focus]);

	useLatestInput(handleInput, inputOptions);

	return (
		<TextInputRows containerRef={containerRef} renderModel={renderModel} />
	);
}
