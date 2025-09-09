import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useColor } from "../theme.ts";
import { InputHistory } from "../input-history/index.ts";

interface Props {
  inputHistory: InputHistory,
  value: string;
  onChange: (s: string) => any;
  onSubmit: () => any;
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
    <Box width="100%" borderStyle="round" borderColor={themeColor} gap={1}>
      <Text color="gray">&gt;</Text>
      <TextInput
        value={props.value}
        onChange={handleChange}
        onSubmit={handleSubmit}
      />
    </Box>
  );
});