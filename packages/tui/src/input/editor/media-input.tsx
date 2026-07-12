import { Box, Text } from "ink";
import { type ReactNode, useCallback, useState } from "react";
import { normalizeRenderedLineBreaks } from "../../render/lines.ts";
import {
	canDisplayImage,
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	type MultimodalConfig,
} from "../../runtime/models/catalog/main.ts";
import type { Transport } from "../../runtime/workspace/common.ts";
import type { InputHistory } from "../../shell/input.ts";
import { hasNonWhitespace } from "../../shell/text-processing.ts";
import { useCtrlC } from "../ctrl-c.tsx";
import { type ImageInfo, loadImageFromPath } from "../images.ts";
import { InputWithHistory } from "./history-input.tsx";
import type { VimMode } from "./vim.tsx";

export type MultimediaInputProps = {
	inputHistory: InputHistory;
	transport: Transport;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (text: string, images: ImageInfo[]) => void | Promise<void>;
	vimEnabled?: boolean;
	vimMode?: VimMode;
	setVimMode?: (mode: VimMode) => void;
	modalities?: MultimodalConfig;
};

export function getUnsupportedImageAttachmentsMessage(): string {
	return `This model does not support image attachments.\nSwitch to a supported model (e.g. ${DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE}).`;
}

export function formatImageLoadError(
	inputPath: string,
	error: unknown,
): string {
	return `Failed to load image from path: ${inputPath}.\n${error}`;
}

export function shouldSubmitMultimediaInput(
	value: string,
	attachedImages: readonly unknown[],
): boolean {
	return hasNonWhitespace(value) || attachedImages.length > 0;
}

export function MultimediaInput({
	inputHistory,
	transport,
	value,
	onChange,
	onSubmit,
	vimEnabled,
	vimMode,
	setVimMode,
	modalities,
}: MultimediaInputProps) {
	const [attachedImages, setAttachedImages] = useState<ImageInfo[]>([]);
	const [showLoadingImageBadge, setShowLoadingImageBadge] = useState(false);
	const [errorMessages, setErrorMessages] = useState<string[]>([]);

	useCtrlC(
		useCallback(() => {
			if (vimEnabled) return;
			setAttachedImages([]);
			setErrorMessages([]);
		}, [vimEnabled]),
	);

	const tryLoadImage = useCallback(
		async (inputPath: string): Promise<ImageInfo | null> => {
			const image = await loadImageFromPath(inputPath);
			if (!image.success) {
				setErrorMessages((prev) =>
					appendString(prev, formatImageLoadError(inputPath, image.error)),
				);
				return null;
			}
			const imageCheck = canDisplayImage(modalities, image.data);
			if (!imageCheck.ok) {
				setErrorMessages((prev) => appendString(prev, imageCheck.reason));
				return null;
			}
			return image.data;
		},
		[modalities],
	);

	const handleRemoveLastImage = useCallback(() => {
		setAttachedImages(dropLastImage);
	}, []);

	const handleImagePathsAttached = useCallback(
		async (imagePaths: string[]) => {
			if (!modalities?.image?.enabled) {
				setErrorMessages((prev) =>
					appendString(prev, getUnsupportedImageAttachmentsMessage()),
				);
				return;
			}
			if (imagePaths.length === 0) return;

			setShowLoadingImageBadge(true);
			try {
				for (const imagePath of imagePaths) {
					const imageInfo = await tryLoadImage(imagePath);
					if (imageInfo) {
						setAttachedImages((prev) => appendImageInfo(prev, imageInfo));
					}
				}
			} finally {
				setShowLoadingImageBadge(false);
			}
		},
		[modalities, tryLoadImage],
	);

	const handleSubmit = useCallback(() => {
		if (shouldSubmitMultimediaInput(value, attachedImages)) {
			onSubmit(value, attachedImages);
			setAttachedImages([]);
			setErrorMessages([]);
		}
	}, [attachedImages, onSubmit, value]);

	return (
		<Box flexDirection="column" width="100%">
			{renderInputErrorMessages(errorMessages)}
			<InputWithHistory
				attachedImages={attachedImages}
				showLoadingImageBadge={showLoadingImageBadge}
				inputHistory={inputHistory}
				transport={transport}
				value={value}
				onChange={onChange}
				onImagePathsAttached={handleImagePathsAttached}
				onSubmit={handleSubmit}
				onRemoveLastImage={handleRemoveLastImage}
				vimEnabled={vimEnabled}
				vimMode={vimMode}
				setVimMode={setVimMode}
				modalities={modalities}
			/>
		</Box>
	);
}

function renderInputErrorMessages(
	errorMessages: readonly string[],
): ReactNode[] {
	const nodes = new Array<ReactNode>(errorMessages.length);
	for (let index = 0; index < errorMessages.length; index += 1) {
		const errorMessage = errorMessages[index];
		if (errorMessage === undefined) continue;
		nodes[index] = (
			<Box marginBottom={1} key={index}>
				<Text color="red">{normalizeRenderedLineBreaks(errorMessage)}</Text>
			</Box>
		);
	}
	return nodes;
}

function appendString(values: readonly string[], value: string): string[] {
	const next = new Array<string>(values.length + 1);
	for (let index = 0; index < values.length; index += 1) {
		const item = values[index];
		if (item !== undefined) next[index] = item;
	}
	next[values.length] = value;
	return next;
}

function appendImageInfo(
	values: readonly ImageInfo[],
	value: ImageInfo,
): ImageInfo[] {
	const next = new Array<ImageInfo>(values.length + 1);
	for (let index = 0; index < values.length; index += 1) {
		const item = values[index];
		if (item !== undefined) next[index] = item;
	}
	next[values.length] = value;
	return next;
}

function dropLastImage(values: readonly ImageInfo[]): ImageInfo[] {
	const nextLength = values.length - 1;
	if (nextLength <= 0) return [];
	const next = new Array<ImageInfo>(nextLength);
	for (let index = 0; index < nextLength; index += 1) {
		const item = values[index];
		if (item !== undefined) next[index] = item;
	}
	return next;
}
