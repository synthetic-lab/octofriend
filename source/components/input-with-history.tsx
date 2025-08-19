import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useColor } from "../theme.ts";
import { InputHistoryNavigator } from "../input-history.ts";

interface Props {
  value: string;
  onChange: (s: string) => any;
  onSubmit: () => any;
}

export const InputWithHistory = React.memo((props: Props) => {
  const themeColor = useColor();
  const historyNavigator = useRef(new InputHistoryNavigator());
  const [isNavigating, setIsNavigating] = useState(false);

  // Update the navigator's current input when props.value changes from external sources
  useEffect(() => {
    if (!isNavigating) {
      historyNavigator.current.setCurrentInput(props.value);
    }
  }, [props.value, isNavigating]);

  useInput((input, key) => {
    if (key.upArrow) {
      setIsNavigating(true);
      historyNavigator.current.setCurrentInput(props.value);
      const historyItem = historyNavigator.current.navigateUp();
      if (historyItem !== null) {
        props.onChange(historyItem);
      }
      return;
    }

    if (key.downArrow) {
      setIsNavigating(true);
      const historyItem = historyNavigator.current.navigateDown();
      if (historyItem !== null) {
        props.onChange(historyItem);
      }
      return;
    }

    // Reset navigation state when user types anything else
    if (input || key.return || key.escape || key.backspace || key.delete) {
      if (isNavigating) {
        setIsNavigating(false);
        historyNavigator.current.reset();
      }
    }
  });

  const handleSubmit = () => {
    setIsNavigating(false);
    historyNavigator.current.reset();
    props.onSubmit();
  };

  const handleChange = (value: string) => {
    if (isNavigating) {
      setIsNavigating(false);
      historyNavigator.current.reset();
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