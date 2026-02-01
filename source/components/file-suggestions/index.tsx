import React from "react";
import { Box, useInput } from "ink";
import { useFileSearch } from "./use-file-search.js";
import { SuggestionList } from "./SuggestionList.js";

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
  const { results, selectedIndex } = useFileSearch(query, { onSelect });

  useInput(
    (_, key) => {
      if (key.escape && isVisible) {
        onDismiss();
      }
    },
    { isActive: isVisible },
  );

  if (!isVisible || results.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" width="100%">
      <SuggestionList items={results} selectedIndex={selectedIndex} onSelect={onSelect} />
    </Box>
  );
}
