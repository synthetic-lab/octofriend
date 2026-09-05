import React, { useState, useCallback, useEffect } from "react";
import TextInput from "../components/text-input.tsx";
import { useColor } from "../theme.ts";
import { InputHistory } from "../input-history/index.ts";
import { FileSuggestionBox } from "./file-suggestions/index.js";
import { useFileSearch } from "./file-suggestions/use-file-search.ts";
import { ImageInfo } from "../utils/image-utils.ts";
import type { PaintFile, PaintKeyboardEvent } from "paintcannon";
import { useKeyboard } from "../hooks/use-keyboard.ts";
import { TerminalFlex } from "./terminal-flex.tsx";
import type { InputMode, VimMode } from "./input-mode.ts";
interface Props {
  focus?: boolean;
  attachedImages: ImageInfo[];
  inputHistory: InputHistory;
  value: string;
  onChange: (s: string) => any;
  onImageFilesAttached?: (files: PaintFile[]) => any;
  onRemoveLastImage?: () => any;
  onSubmit: (value?: string) => any;
  showLoadingImageBadge?: boolean;
  inputMode?: InputMode;
  setVimMode?: (mode: VimMode) => void;
}
type SuggestionState = {
  triggerPosition: number;
  query: string;
};
function computeSuggestionState(value: string): SuggestionState | null {
  const triggerPosition = value.lastIndexOf("@");
  if (triggerPosition === -1) return null;
  const query = value.slice(triggerPosition + 1);
  if (!/^[a-zA-Z0-9_./-]*$/.test(query)) return null;
  return { triggerPosition, query };
}
export const InputWithHistory = React.memo((props: Props) => {
  const themeColor = useColor();
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [originalInput, setOriginalInput] = useState("");
  const [suggestionState, setSuggestionState] = useState<SuggestionState | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const { results, selectedIndex, selectPrevious, selectNext, selectCurrent } = useFileSearch(
    suggestionState?.query ?? "",
    { enabled: suggestionState !== null },
  );
  const suggestionsVisible = suggestionState !== null && results.length > 0;
  useEffect(() => {
    const next = computeSuggestionState(props.value);
    setSuggestionState(current => {
      if (next === null) return null;
      if (
        current !== null &&
        current.triggerPosition === next.triggerPosition &&
        current.query === next.query
      ) {
        return current;
      }
      return next;
    });
  }, [props.value]);
  useKeyboard(event => {
    if (suggestionState !== null) {
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
    if (suggestionState !== null) {
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
  const handleAutocompleteKeyDown = useCallback(
    (event: PaintKeyboardEvent) => {
      if (suggestionState === null) return;
      if (event.key === "ArrowUp" || (event.shiftKey && event.key === "Tab")) {
        event.preventDefault();
        event.stopPropagation();
        selectPrevious();
        return;
      }
      if (event.key === "ArrowDown" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        selectNext();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSuggestionState(null);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (!suggestionsVisible) return;
        event.stopPropagation();
        const selected = selectCurrent();
        if (selected !== null) handleSuggestionSelect(selected);
        return;
      }
      if (event.ctrlKey && event.key === "c") {
        setSuggestionState(null);
        return;
      }
    },
    [
      suggestionState,
      suggestionsVisible,
      selectPrevious,
      selectNext,
      selectCurrent,
      handleSuggestionSelect,
    ],
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
        {suggestionsVisible && (
          <FileSuggestionBox
            results={results}
            selectedIndex={selectedIndex}
            onSelect={handleSuggestionSelect}
          />
        )}
      </TerminalFlex>

      <TerminalFlex
        style={{
          width: "100%",
          minWidth: 0,
          paddingLeft: 1,
          paddingRight: 1,
          border: "rounded",
          borderColor: themeColor,
        }}
      >
        <TextInput
          focus={props.focus}
          attachedImages={props.attachedImages}
          showLoadingImageBadge={props.showLoadingImageBadge}
          value={props.value}
          onChange={handleChange}
          onRemoveLastImage={props.onRemoveLastImage}
          onImageFilesAttached={props.onImageFilesAttached}
          onSubmit={handleSubmit}
          onKeyDown={handleAutocompleteKeyDown}
          inputMode={props.inputMode}
        />
      </TerminalFlex>
    </TerminalFlex>
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
