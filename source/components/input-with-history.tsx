import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "../components/text-input.tsx";
import { useColor } from "../theme.ts";
import { InputHistory } from "../input-history/index.ts";
import { FileSuggestionBox } from "./file-suggestions/index.js";
import { ImageInfo } from "../utils/image-utils.ts";
import { MultimodalConfig } from "../providers.ts";

interface Props {
  attachedImages: ImageInfo[];
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onImagePathsAttached?: (imagePaths: string[]) => any;
  onRemoveLastImage?: () => any;
  onSubmit: (value?: string) => any;
  showLoadingImageBadge?: boolean;
  vimEnabled?: boolean;
  vimMode?: "NORMAL" | "INSERT";
  setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  modalities?: MultimodalConfig;
}

export const InputWithHistory = React.memo((props: Props) => {
  const themeColor = useColor();
  const [suggestionState, setSuggestionState] = useState<{
    isVisible: boolean;
    triggerPosition: number;
    query: string;
  } | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());

  const currentIndexRef = useRef(-1);
  const originalInputRef = useRef("");

  useInput((input, key) => {
    if (suggestionState?.isVisible) {
      return;
    }

    if (key.upArrow) {
      if (currentIndexRef.current === -1) {
        originalInputRef.current = props.value;
      }

      const history = props.inputHistory.getCurrentHistory();
      if (history.length === 0) return;

      const newIndex =
        currentIndexRef.current === -1
          ? history.length - 1
          : Math.max(0, currentIndexRef.current - 1);
      currentIndexRef.current = newIndex;
      props.onChange(history[newIndex]);
      return;
    }

    if (key.downArrow) {
      const history = props.inputHistory.getCurrentHistory();
      if (currentIndexRef.current === -1 || history.length === 0) return;

      if (currentIndexRef.current < history.length - 1) {
        const newIndex = currentIndexRef.current + 1;
        currentIndexRef.current = newIndex;
        props.onChange(history[newIndex]);
      } else {
        // Reset to original input
        currentIndexRef.current = -1;
        props.onChange(originalInputRef.current);
      }
      return;
    }

    // Reset navigation state when user types anything else
    if (input || key.return || key.escape || key.backspace || key.delete) {
      if (currentIndexRef.current !== -1) {
        currentIndexRef.current = -1;
        originalInputRef.current = "";
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

    currentIndexRef.current = -1;
    originalInputRef.current = "";
    setSelectedSuggestions(new Set());
    props.onSubmit(transformedValue);
  };

  const handleChange = (value: string) => {
    if (currentIndexRef.current !== -1) {
      currentIndexRef.current = -1;
      originalInputRef.current = "";
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
          attachedImages={props.attachedImages}
          showLoadingImageBadge={props.showLoadingImageBadge}
          value={props.value}
          onChange={handleChange}
          onRemoveLastImage={props.onRemoveLastImage}
          onImagePathsAttached={props.onImagePathsAttached}
          onSubmit={handleSubmit}
          vimEnabled={props.vimEnabled}
          vimMode={props.vimMode}
          setVimMode={props.setVimMode}
          modalities={props.modalities}
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
