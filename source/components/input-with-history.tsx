import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "../components/text-input.tsx";
import { useColor } from "../theme.ts";
import { InputHistory } from "../input-history/index.ts";
import { ImageInfo } from "../utils/image-utils.ts";

interface Props {
  attachedImages: ImageInfo[];
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onImagePathsAttached?: (imagePaths: string[]) => any;
  onRemoveLastImage?: () => any;
  onSubmit: () => any;
  isLoadingImage?: boolean;
  vimEnabled?: boolean;
  vimMode?: "NORMAL" | "INSERT";
  setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  multimodal?: boolean;
}

export const InputWithHistory = React.memo((props: Props) => {
  const themeColor = useColor();
  const [currentIndex, setCurrentIndex] = useState(-1);

  const [originalInput, setOriginalInput] = useState("");

  useInput((input, key) => {
    if (key.upArrow) {
      if (currentIndex === -1) {
        setOriginalInput(props.value);
      }

      const history = props.inputHistory.getCurrentHistory();
      if (history.length === 0) return;

      const newIndex = currentIndex === -1 ? history.length - 1 : Math.max(0, currentIndex - 1);
      setCurrentIndex(newIndex);
      props.onChange(history[newIndex]);
      return;
    }

    if (key.downArrow) {
      const history = props.inputHistory.getCurrentHistory();
      if (currentIndex === -1 || history.length === 0) return;

      if (currentIndex < history.length - 1) {
        const newIndex = currentIndex + 1;
        setCurrentIndex(newIndex);
        props.onChange(history[newIndex]);
      } else {
        // Reset to original input
        setCurrentIndex(-1);
        props.onChange(originalInput);
      }
      return;
    }

    // Reset navigation state when user types anything else
    if (input || key.return || key.escape || key.backspace || key.delete) {
      if (currentIndex !== -1) {
        setCurrentIndex(-1);
        setOriginalInput("");
      }
    }
  });

  const handleSubmit = () => {
    if (props.value.trim()) {
      props.inputHistory.appendToInputHistory(props.value.trim());
    }

    setCurrentIndex(-1);
    setOriginalInput("");
    props.onSubmit();
  };

  const handleChange = (value: string) => {
    if (currentIndex !== -1) {
      setCurrentIndex(-1);
      setOriginalInput("");
    }
    props.onChange(value);
  };

  return (
    <Box
      width="100%"
      borderLeft={false}
      borderRight={false}
      borderStyle="single"
      borderColor={themeColor}
      gap={1}
    >
      <Text color="gray">&gt;</Text>
      <TextInput
        attachedImages={props.attachedImages}
        isLoadingImage={props.isLoadingImage}
        value={props.value}
        onChange={handleChange}
        onRemoveLastImage={props.onRemoveLastImage}
        onImagePathsAttached={props.onImagePathsAttached}
        onSubmit={handleSubmit}
        vimEnabled={props.vimEnabled}
        vimMode={props.vimMode}
        setVimMode={props.setVimMode}
        multimodal={props.multimodal}
      />
    </Box>
  );
});
