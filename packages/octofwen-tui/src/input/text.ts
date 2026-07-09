import {
	type EmacsKeyHandler,
	type EmacsKeyHandlerResult,
	useEmacsKeyHandler,
} from "./text_editing/emacs-key-handler.ts";
import {
	InputWithHistory,
	type InputWithHistoryProps,
} from "./text_editing/input-with-history.tsx";
import {
	fileSuggestionTrigger,
	replaceSelectedMentions,
} from "./text_editing/mentions.ts";
import {
	formatImageLoadError,
	getUnsupportedImageAttachmentsMessage,
	MultimediaInput,
	type MultimediaInputProps,
	shouldSubmitMultimediaInput,
} from "./text_editing/multimedia-input.tsx";
import {
	nextTextBoundary,
	previousTextBoundary,
} from "./text_editing/text-boundaries.ts";
import {
	initialTextInputMeasuredWidth,
	nextTextInputMeasuredWidth,
	TextInput,
	type TextInputProps,
} from "./text_editing/text-input.tsx";
import {
	computeImageBadgeLayout,
	getImageBadgeText,
	getImageBadgeWidth,
	type ImageBadgeLayout,
	type ImageBadgeLayoutItem,
} from "./text_editing/text-input-badges.ts";
import { splitRenderedTextLines } from "./text_editing/text-input-rendering.tsx";
import {
	createVimKeyHandler,
	useVimKeyHandler,
	type VimKeyHandler,
	type VimKeyHandlerResult,
	type VimMode,
	VimModeIndicator,
} from "./text_editing/vim.tsx";

export type {
	EmacsKeyHandler,
	EmacsKeyHandlerResult,
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
	fileSuggestionTrigger,
	formatImageLoadError,
	getImageBadgeText,
	getImageBadgeWidth,
	getUnsupportedImageAttachmentsMessage,
	InputWithHistory,
	initialTextInputMeasuredWidth,
	MultimediaInput,
	nextTextBoundary,
	nextTextInputMeasuredWidth,
	previousTextBoundary,
	replaceSelectedMentions,
	shouldSubmitMultimediaInput,
	splitRenderedTextLines,
	TextInput,
	useEmacsKeyHandler,
	useVimKeyHandler,
	VimModeIndicator,
};
