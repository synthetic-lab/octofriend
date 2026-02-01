import React from "react";
import { Box, Text } from "ink";
import { useColor } from "../../theme.ts";

interface SuggestionListProps {
  items: string[];
  selectedIndex: number;
  onSelect: (filename: string) => void;
}

export function SuggestionList({ items, selectedIndex, onSelect }: SuggestionListProps) {
  const themeColor = useColor();

  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const displayPath = item.length > 50 ? "..." + item.slice(-47) : item;

        return (
          <Box key={item}>
            {isSelected ? (
              <Text inverse backgroundColor={themeColor}>
                {">"} {displayPath}
              </Text>
            ) : (
              <Text>
                {"  "} {displayPath}
              </Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
