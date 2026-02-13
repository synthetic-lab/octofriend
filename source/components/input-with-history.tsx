import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "../components/text-input.tsx";
import { useColor } from "../theme.ts";
import { InputHistory } from "../input-history/index.ts";
import { FileSuggestionBox } from "./file-suggestions/index.js";

interface Props {
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onSubmit: (value?: string) => any;
  vimEnabled?: boolean;
  vimMode?: "NORMAL" | "INSERT";
  setVimMode?: (mode: "NORMAL" | "INSERT") => void;
}

export const InputWithHistory = React.memo((props: Props) => {
  const themeColor = useColor();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [originalInput, setOriginalInput] = useState("");
  const [suggestionState, setSuggestionState] = useState<{
    isVisible: boolean;
    triggerPosition: number;
    query: string;
  } | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  useInput((input, key) => {
    if (suggestionState?.isVisible) {
      return;
    }

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
    if (suggestionState?.isVisible) {
      return;
    }

    const transformedValue = replaceSelectedMentions(props.value, selectedSuggestions);

    if (props.value.trim()) {
      props.inputHistory.appendToInputHistory(props.value.trim());
    }

    setCurrentIndex(-1);
    setOriginalInput("");
    setSelectedSuggestions(new Set());
    props.onSubmit(transformedValue);
  };

  const handleChange = (value: string) => {
    if (currentIndex !== -1) {
      setCurrentIndex(-1);
      setOriginalInput("");
    }
    props.onChange(value);

    const atIndex = value.lastIndexOf("@");
    if (atIndex !== -1) {
      const query = value.slice(atIndex + 1);

      // Only show suggestion if actively typing a filename after @
      // Check if query looks like a valid partial filename (no spaces, valid chars)
      const isTypingFilename = /^[a-zA-Z0-9_./-]*$/.test(query);

      if (isTypingFilename) {
        setSuggestionState({
          isVisible: true,
          triggerPosition: atIndex,
          query,
        });
      } else {
        // User moved on (added space or other delimiter) - dismiss suggestion
        setSuggestionState(null);
      }
    } else {
      setSuggestionState(null);
    }
  };

  const handleSuggestionSelect = useCallback(
    (filename: string) => {
      if (!suggestionState) return;

      const before = props.value.slice(0, suggestionState.triggerPosition);
      const after = props.value.slice(
        suggestionState.triggerPosition + suggestionState.query.length + 1,
      );
      // Keep the @ symbol in the editor; it gets replaced with a path on submit.
      const newValue = before + "@" + filename + " " + after;

      props.onChange(newValue);
      setSelectedSuggestions(prev => {
        const next = new Set(prev);
        next.add(filename);
        return next;
      });
      setSuggestionState(null);
    },
    [props.value, suggestionState],
  );

  return (
    <Box flexDirection="column">
      <Box flexGrow={1} flexDirection="column-reverse" justifyContent="flex-end">
        {suggestionState?.isVisible && (
          <FileSuggestionBox
            query={suggestionState.query}
            isVisible={suggestionState.isVisible}
            onSelect={handleSuggestionSelect}
            onDismiss={() => setSuggestionState(null)}
          />
        )}
      </Box>

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
          value={props.value}
          onChange={handleChange}
          onSubmit={handleSubmit}
          vimEnabled={props.vimEnabled}
          vimMode={props.vimMode}
          setVimMode={props.setVimMode}
        />
      </Box>
    </Box>
  );
});

function replaceSelectedMentions(input: string, selectedSuggestions: Set<string>): string {
  let output = input;

  for (const filename of selectedSuggestions) {
    const normalizedPath =
      filename.startsWith("/") || filename.startsWith("./") || filename.startsWith("../")
        ? filename
        : `./${filename}`;

    const escapedFilename = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const mentionRegex = new RegExp(`(^|[^\\w@])@${escapedFilename}(?=$|[^\\w./-])`, "g");

    output = output.replace(mentionRegex, `$1${normalizedPath}`);
  }

  return output;
}
