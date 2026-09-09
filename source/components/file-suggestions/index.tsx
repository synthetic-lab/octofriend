import React from "react";
import { useFileSearch } from "./use-file-search.ts";
import { SuggestionList } from "./suggestion-list.tsx";
import { KEYBOARD_PRIORITY, useKeyboard } from "../../hooks/use-keyboard.ts";
import { TerminalFlex } from "../terminal-flex.tsx";
interface FileSuggestionBoxProps {
  query: string;
  isVisible: boolean;
  onSelect: (filename: string) => void;
  onDismiss: () => void;
  maxHeight?: number;
}
export function FileSuggestionBox({
  query,
  isVisible,
  onSelect,
  onDismiss,
}: FileSuggestionBoxProps) {
  const { results, selectedIndex } = useFileSearch(query, {
    onSelect,
  });
  useKeyboard(
    event => {
      if (event.key === "Escape" && isVisible) {
        event.preventDefault();
        onDismiss();
        return true;
      }
      return false;
    },
    { isActive: isVisible, priority: KEYBOARD_PRIORITY.OVERLAY },
  );
  if (!isVisible || results.length === 0) {
    return null;
  }
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        border: "rounded",
        borderColor: "gray",
        width: "100%",
      }}
    >
      <SuggestionList items={results} selectedIndex={selectedIndex} onSelect={onSelect} />
    </TerminalFlex>
  );
}
