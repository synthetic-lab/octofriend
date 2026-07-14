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
import { Div, Span } from "paintcannon-react";
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
export const MultimediaInput = (props: Props) => {
  const [attachedImages, setAttachedImages] = useState<ImageInfo[]>([]);
  const [showLoadingImageBadge, setShowLoadingImageBadge] = useState(false);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  useCtrlC(() => {
    if (props.vimEnabled) return;
    setAttachedImages([]);
    setErrorMessages([]);
  });
  const handleRemoveLastImage = useCallback(() => {
    setAttachedImages(prev => prev.slice(0, -1));
  }, []);
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
          if (imageCheck.ok) setAttachedImages(prev => [...prev, image]);
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
    [props.modalities],
  );
  const handleSubmit = useCallback(() => {
    if (props.value.trim() || attachedImages.length > 0) {
      props.onSubmit(props.value, attachedImages);
      setAttachedImages([]);
      setErrorMessages([]);
    }
  }, [props, attachedImages]);
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        width: "100%",
        minWidth: 0,
      }}
    >
      {errorMessages.map((errorMessage, index) => (
        <Div
          key={index}
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
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
        </Div>
      ))}
      <InputWithHistory
        attachedImages={attachedImages}
        showLoadingImageBadge={showLoadingImageBadge}
        inputHistory={props.inputHistory}
        value={props.value}
        onChange={props.onChange}
        onImageFilesAttached={handleImageFilesAttached}
        onSubmit={handleSubmit}
        onRemoveLastImage={handleRemoveLastImage}
        vimEnabled={props.vimEnabled}
        vimMode={props.vimMode}
        setVimMode={props.setVimMode}
      />
    </Div>
  );
};
