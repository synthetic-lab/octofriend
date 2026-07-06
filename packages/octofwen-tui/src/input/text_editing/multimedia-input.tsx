import { Box, Text } from "ink";
import { useCallback, useState } from "react";
import type { InputHistory } from "../../app/input_history.ts";
import {
	canDisplayImage,
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	type MultimodalConfig,
} from "../../internal/model-provider-catalog/main.ts";
import type { Transport } from "../../internal/transport/common.ts";
import { useCtrlC } from "../ctrl_c.tsx";
import { type ImageInfo, loadImageFromPath } from "../image_attachments.ts";
import { InputWithHistory } from "./input-with-history.tsx";
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
	return value.trim().length > 0 || attachedImages.length > 0;
}

export function MultimediaInput(props: MultimediaInputProps) {
	const [attachedImages, setAttachedImages] = useState<ImageInfo[]>([]);
	const [showLoadingImageBadge, setShowLoadingImageBadge] = useState(false);
	const [errorMessages, setErrorMessages] = useState<string[]>([]);

	useCtrlC(() => {
		if (props.vimEnabled) return;
		setAttachedImages([]);
		setErrorMessages([]);
	});

	const tryLoadImage = useCallback(
		async (inputPath: string): Promise<ImageInfo | null> => {
			try {
				const image = await loadImageFromPath(inputPath);
				const imageCheck = canDisplayImage(props.modalities, image);
				if (!imageCheck.ok) {
					setErrorMessages((prev) => [...prev, imageCheck.reason]);
					return null;
				}
				return image;
			} catch (error) {
				setErrorMessages((prev) => [
					...prev,
					formatImageLoadError(inputPath, error),
				]);
				return null;
			}
		},
		[props.modalities],
	);

	const handleRemoveLastImage = useCallback(() => {
		setAttachedImages((prev) => prev.slice(0, -1));
	}, []);

	const handleImagePathsAttached = useCallback(
		async (imagePaths: string[]) => {
			if (!props.modalities?.image?.enabled) {
				setErrorMessages((prev) => [
					...prev,
					getUnsupportedImageAttachmentsMessage(),
				]);
				return;
			}

			for (const imagePath of imagePaths) {
				setShowLoadingImageBadge(true);
				const imageInfo = await tryLoadImage(imagePath);

				setShowLoadingImageBadge(false);
				if (imageInfo) {
					setAttachedImages((prev) => [...prev, imageInfo]);
				}
			}
		},
		[tryLoadImage, props.modalities],
	);

	const handleSubmit = useCallback(() => {
		if (shouldSubmitMultimediaInput(props.value, attachedImages)) {
			props.onSubmit(props.value, attachedImages);
			setAttachedImages([]);
			setErrorMessages([]);
		}
	}, [props, attachedImages]);

	return (
		<Box flexDirection="column" width="100%">
			{errorMessages.map((errorMessage, index) => (
				<Box marginBottom={1} key={index}>
					<Text color="red">{errorMessage}</Text>
				</Box>
			))}
			<InputWithHistory
				attachedImages={attachedImages}
				showLoadingImageBadge={showLoadingImageBadge}
				inputHistory={props.inputHistory}
				transport={props.transport}
				value={props.value}
				onChange={props.onChange}
				onImagePathsAttached={handleImagePathsAttached}
				onSubmit={handleSubmit}
				onRemoveLastImage={handleRemoveLastImage}
				vimEnabled={props.vimEnabled}
				vimMode={props.vimMode}
				setVimMode={props.setVimMode}
				modalities={props.modalities}
			/>
		</Box>
	);
}
