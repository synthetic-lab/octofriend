import React, { useState, useCallback } from "react";
import TextInput from "../components/text-input.tsx";
import { useColor } from "../theme.ts";
import { InputHistory } from "../input-history/index.ts";
import { FileSuggestionBox } from "./file-suggestions/index.js";
import { ImageInfo } from "../utils/image-utils.ts";
import type { PaintFile } from "paintcannon";
import { useKeyboard } from "../hooks/use-keyboard.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
interface Props {
  attachedImages: ImageInfo[];
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onImageFilesAttached?: (files: PaintFile[]) => any;
  onRemoveLastImage?: () => any;
  onSubmit: (value?: string) => any;
  showLoadingImageBadge?: boolean;
  vimEnabled?: boolean;
  vimMode?: "NORMAL" | "INSERT";
  setVimMode?: (mode: "NORMAL" | "INSERT") => void;
}
export const InputWithHistory = (props: Props) => {
  const themeColor = useColor();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [originalInput, setOriginalInput] = useState("");
  const [suggestionState, setSuggestionState] = useState<{
    isVisible: boolean;
    triggerPosition: number;
    query: string;
  } | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  useKeyboard(event => {
    if (suggestionState?.isVisible) {
      return;
    }
    if (event.key === "ArrowUp") {
      if (currentIndex === -1) {
        setOriginalInput(props.value);
      }
      const history = props.inputHistory.getCurrentHistory();
      if (history.length === 0) return;
      event.preventDefault();
      const newIndex = currentIndex === -1 ? history.length - 1 : Math.max(0, currentIndex - 1);
      setCurrentIndex(newIndex);
      props.onChange(history[newIndex]);
      return;
    }
    if (event.key === "ArrowDown") {
      const history = props.inputHistory.getCurrentHistory();
      if (currentIndex === -1 || history.length === 0) return;
      event.preventDefault();
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
    if (
      event.key ||
      event.key === "Enter" ||
      event.key === "Escape" ||
      event.key === "Backspace" ||
      event.key === "Delete"
    ) {
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
    <TerminalFlex
      style={{
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <TerminalFlex
        style={{
          flexGrow: 1,
          flexDirection: "column-reverse",
          justifyContent: "flex-end",
        }}
      >
        {suggestionState?.isVisible && (
          <FileSuggestionBox
            query={suggestionState.query}
            isVisible={suggestionState.isVisible}
            onSelect={handleSuggestionSelect}
            onDismiss={() => setSuggestionState(null)}
          />
        )}
      </TerminalFlex>

      <TerminalFlex
        style={{
          width: "100%",
          minWidth: 0,
          border: "rounded",
          borderColor: themeColor,
        }}
      >
        <TextInput
          attachedImages={props.attachedImages}
          showLoadingImageBadge={props.showLoadingImageBadge}
          value={props.value}
          onChange={handleChange}
          onRemoveLastImage={props.onRemoveLastImage}
          onImageFilesAttached={props.onImageFilesAttached}
          onSubmit={handleSubmit}
          onKeyDown={event => {
            if (event.key === "Enter" && suggestionState?.isVisible) event.preventDefault();
          }}
          vimEnabled={props.vimEnabled}
          vimMode={props.vimMode}
          setVimMode={props.setVimMode}
        />
      </TerminalFlex>
    </TerminalFlex>
  );
};
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
