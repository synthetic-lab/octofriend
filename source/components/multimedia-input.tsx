import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { InputWithHistory } from "./input-with-history.tsx";
import { InputHistory } from "../input-history/index.ts";
import { ImageInfo, loadImageFromPath } from "../utils/image-utils.ts";
import { useCtrlC } from "./exit-on-double-ctrl-c.tsx";
import {
  DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
  MultimodalConfig,
  canDisplayImage,
} from "../providers.ts";

interface Props {
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onSubmit: (text: string, images: ImageInfo[]) => any;
  vimEnabled?: boolean;
  vimMode?: "NORMAL" | "INSERT";
  setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  modalities?: MultimodalConfig;
}

export const MultimediaInput = React.memo((props: Props) => {
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
          setErrorMessages(prev => [...prev, imageCheck.reason]);
          return null;
        }
        return image;
      } catch (error) {
        setErrorMessages(prev => [
          ...prev,
          `Failed to load image from path: ${inputPath}.\n${error}`,
        ]);
        return null;
      }
    },
    [props.modalities],
  );

  const handleRemoveLastImage = useCallback(() => {
    setAttachedImages(prev => prev.slice(0, -1));
  }, []);

  const handleImagePathsAttached = useCallback(
    async (imagePaths: string[]) => {
      if (!props.modalities?.image?.enabled) {
        setErrorMessages(prev => [
          ...prev,
          `This model does not support image attachments.\nSwitch to a supported model (e.g. ${DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE}).`,
        ]);
        return;
      }
      for (const imagePath of imagePaths) {
        setShowLoadingImageBadge(true);
        const imageInfo = await tryLoadImage(imagePath);

        setShowLoadingImageBadge(false);
        if (imageInfo) {
          setAttachedImages(prev => [...prev, imageInfo]);
        }
      }
    },
    [tryLoadImage, props.modalities],
  );

  const handleSubmit = useCallback(() => {
    if (props.value.trim() || attachedImages.length > 0) {
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
});
