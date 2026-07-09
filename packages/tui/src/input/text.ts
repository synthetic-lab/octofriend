import {
	type EmacsKeyHandler,
	type EmacsKeyHandlerResult,
	useEmacsKeyHandler,
} from "./editor/emacs-keys";
import {
	InputWithHistory,
	type InputWithHistoryProps,
} from "./editor/history-input";
import {
	fileSuggestionTrigger,
	replaceSelectedMentions,
} from "./editor/mentions";
import {
	formatImageLoadError,
	getUnsupportedImageAttachmentsMessage,
	MultimediaInput,
	type MultimediaInputProps,
	shouldSubmitMultimediaInput,
} from "./editor/media-input";
import {
	nextTextBoundary,
	previousTextBoundary,
} from "./editor/boundaries";
import {
	initialTextInputMeasuredWidth,
	nextTextInputMeasuredWidth,
	TextInput,
	type TextInputProps,
} from "./editor/text-input";
import {
	computeImageBadgeLayout,
	getImageBadgeText,
	getImageBadgeWidth,
	type ImageBadgeLayout,
	type ImageBadgeLayoutItem,
} from "./editor/badges";
import { splitRenderedTextLines } from "./editor/render";
import {
	createVimKeyHandler,
	useVimKeyHandler,
	type VimKeyHandler,
	type VimKeyHandlerResult,
	type VimMode,
	VimModeIndicator,
} from "./editor/vim";

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
