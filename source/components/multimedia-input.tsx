import React, { useState, useCallback } from "react";
import { InputWithHistory } from "./input-with-history.tsx";
import { InputHistory } from "../input-history/index.ts";
import { ImageInfo, loadImageFromPaintFile } from "../utils/image-utils.ts";
import type { PaintFile } from "paintcannon";
import { useCtrlC } from "./exit-on-double-ctrl-c.tsx";
import {
  DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
  MultimodalConfig,
  canDisplayImage,
} from "../providers.ts";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
import { DEFAULT_INPUT_MODE, type InputMode, type VimMode } from "./input-mode.ts";
interface Props {
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  attachedImages: ImageInfo[];
  addAttachedImage: (image: ImageInfo) => void;
  removeLastAttachedImage: () => void;
  clearAttachedImages: () => void;
  onSubmit: (text: string, images: ImageInfo[]) => any;
  inputMode?: InputMode;
  setVimMode?: (mode: VimMode) => void;
  modalities?: MultimodalConfig;
}
export const MultimediaInput = (props: Props) => {
  const [showLoadingImageBadge, setShowLoadingImageBadge] = useState(false);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const inputMode = props.inputMode ?? DEFAULT_INPUT_MODE;
  useCtrlC(() => {
    if (inputMode.kind === "vim") return;
    props.clearAttachedImages();
    setErrorMessages([]);
  });
  const handleRemoveLastImage = useCallback(() => {
    props.removeLastAttachedImage();
  }, [props.removeLastAttachedImage]);
  const handleImageFilesAttached = useCallback(
    async (files: PaintFile[]) => {
      if (!props.modalities?.image?.enabled) {
        setErrorMessages(prev => [
          ...prev,
          `This model does not support image attachments.\nSwitch to a supported model (e.g. ${DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE}).`,
        ]);
        return;
      }
      for (const file of files) {
        setShowLoadingImageBadge(true);
        try {
          const image = await loadImageFromPaintFile(file);
          const imageCheck = canDisplayImage(props.modalities, image);
          if (imageCheck.ok) props.addAttachedImage(image);
          else setErrorMessages(prev => [...prev, imageCheck.reason]);
        } catch (error) {
          setErrorMessages(prev => [
            ...prev,
            `Failed to attach pasted image ${file.name}.\n${error}`,
          ]);
        } finally {
          setShowLoadingImageBadge(false);
        }
      }
    },
    [props.modalities, props.addAttachedImage],
  );
  const handleSubmit = useCallback(() => {
    if (props.value.trim() || props.attachedImages.length > 0) {
      props.onSubmit(props.value, props.attachedImages);
      props.clearAttachedImages();
      setErrorMessages([]);
    }
  }, [props]);
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
      }}
    >
      {errorMessages.map((errorMessage, index) => (
        <TerminalFlex
          key={index}
          style={{
            marginBottom: 1,
          }}
        >
          <Span
            style={{
              color: "red",
            }}
          >
            {errorMessage}
          </Span>
        </TerminalFlex>
      ))}
      <InputWithHistory
        attachedImages={props.attachedImages}
        showLoadingImageBadge={showLoadingImageBadge}
        inputHistory={props.inputHistory}
        value={props.value}
        onChange={props.onChange}
        onImageFilesAttached={handleImageFilesAttached}
        onSubmit={handleSubmit}
        onRemoveLastImage={handleRemoveLastImage}
        inputMode={inputMode}
        setVimMode={props.setVimMode}
      />
    </TerminalFlex>
  );
};
