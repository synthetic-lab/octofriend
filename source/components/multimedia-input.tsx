import React, { useState, useCallback } from "react";
import fs from "fs/promises";
import { Box, Text } from "ink";
import { InputWithHistory } from "./input-with-history.tsx";
import { InputHistory } from "../input-history/index.ts";
import { ImageInfo, loadImageFromPath } from "../utils/image-utils.ts";
import { useCtrlC } from "./exit-on-double-ctrl-c.tsx";

const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;

interface Props {
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onSubmit: (text: string, images: ImageInfo[]) => any;
  vimEnabled?: boolean;
  vimMode?: "NORMAL" | "INSERT";
  setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  multimodal?: boolean;
}

export const MultimediaInput = React.memo((props: Props) => {
  const [attachedImages, setAttachedImages] = useState<ImageInfo[]>([]);
  const [isLoadingImage, setIsLoadingImage] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useCtrlC(() => {
    if (attachedImages.length > 0) {
      setAttachedImages([]);
    }
  });

  const tryLoadImage = useCallback(async (inputPath: string): Promise<ImageInfo | null> => {
    try {
      await fs.access(inputPath);
      const stats = await fs.stat(inputPath);
      if (stats.size > MAX_IMAGE_SIZE_BYTES) {
        setErrorMessage(`The maximum image size for this model is ${MAX_IMAGE_SIZE_MB}MB.`);
        return null;
      }
      return await loadImageFromPath(inputPath);
    } catch {
      setErrorMessage(`Failed to load image from path: ${inputPath}.`);
      return null;
    }
  }, []);

  const handleRemoveLastImage = useCallback(() => {
    setAttachedImages(prev => prev.slice(0, -1));
  }, []);

  const handleImagePathsAttached = useCallback(
    async (imagePaths: string[]) => {
      if (!props.multimodal) {
        // TODO: Replace with a constant that has multimodal selected
        setErrorMessage(
          "This model does not support image attachments.\nSwitch to a supported model (e.g. Kimi K2.5).",
        );
        return;
      }
      setIsLoadingImage(true);
      const newImages: ImageInfo[] = [];
      for (const imagePath of imagePaths) {
        const imageInfo = await tryLoadImage(imagePath);
        if (
          imageInfo &&
          !attachedImages?.some(attachedImage => attachedImage.filePath === imageInfo.filePath)
        ) {
          newImages.push(imageInfo);
        }
      }
      setIsLoadingImage(false);
      if (newImages.length > 0) {
        setAttachedImages(prev => [...prev, ...newImages]);
      }
    },
    [tryLoadImage, attachedImages, setAttachedImages, props.multimodal],
  );

  const handleSubmit = useCallback(() => {
    if (props.value.trim() || attachedImages.length > 0) {
      props.onSubmit(props.value, attachedImages);
      setAttachedImages([]);
    }
  }, [props, attachedImages]);

  return (
    <Box flexDirection="column" width="100%">
      {errorMessage && (
        <Box marginBottom={1}>
          <Text color="red">{errorMessage}</Text>
        </Box>
      )}
      <InputWithHistory
        attachedImages={attachedImages}
        isLoadingImage={isLoadingImage}
        inputHistory={props.inputHistory}
        value={props.value}
        onChange={props.onChange}
        onImagePathsAttached={handleImagePathsAttached}
        onSubmit={handleSubmit}
        onRemoveLastImage={handleRemoveLastImage}
        vimEnabled={props.vimEnabled}
        vimMode={props.vimMode}
        setVimMode={props.setVimMode}
        multimodal={props.multimodal}
      />
    </Box>
  );
});
