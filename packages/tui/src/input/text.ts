import {
	computeImageBadgeLayout,
	getImageBadgeText,
	getImageBadgeWidth,
	type ImageBadgeLayout,
	type ImageBadgeLayoutItem,
} from "./editor/badges.ts";
import { nextTextBoundary, previousTextBoundary } from "./editor/boundaries.ts";
import {
	type EmacsKeyHandler,
	type EmacsKeyHandlerResult,
	useEmacsKeyHandler,
} from "./editor/emacs-keys.ts";
import {
	InputWithHistory,
	type InputWithHistoryProps,
} from "./editor/history-input.tsx";
import {
	formatImageLoadError,
	getUnsupportedImageAttachmentsMessage,
	MultimediaInput,
	type MultimediaInputProps,
	shouldSubmitMultimediaInput,
} from "./editor/media-input.tsx";
import {
	fileSuggestionTrigger,
	replaceSelectedMentions,
} from "./editor/mentions.ts";
import { splitRenderedTextLines } from "./editor/render.tsx";
import {
	initialTextInputMeasuredWidth,
	nextTextInputMeasuredWidth,
	TextInput,
	type TextInputProps,
} from "./editor/text-input.tsx";
import {
	createVimKeyHandler,
	useVimKeyHandler,
	type VimKeyHandler,
	type VimKeyHandlerResult,
	type VimMode,
	VimModeIndicator,
} from "./editor/vim.tsx";

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
