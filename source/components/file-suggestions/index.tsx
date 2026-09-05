import React from "react";
import { SuggestionList } from "./suggestion-list.tsx";
import { TerminalFlex } from "../terminal-flex.tsx";
type FileSuggestionBoxProps = {
  results: string[];
  selectedIndex: number;
  onSelect: (filename: string) => void;
};
export function FileSuggestionBox({ results, selectedIndex, onSelect }: FileSuggestionBoxProps) {
  if (results.length === 0) {
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
