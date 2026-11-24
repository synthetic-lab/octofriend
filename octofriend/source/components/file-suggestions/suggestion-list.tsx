import React from "react";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "../terminal-flex.tsx";
import { BACKGROUND_COLOR, FOREGROUND_COLOR } from "../../theme.ts";
interface SuggestionListProps {
  items: string[];
  selectedIndex: number;
  onSelect: (filename: string) => void;
}
export function SuggestionList({ items, selectedIndex }: SuggestionListProps) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const displayPath = item.length > 50 ? "..." + item.slice(-47) : item;
        return (
          <TerminalFlex key={item}>
            {isSelected ? (
              <Span
                style={{
                  color: BACKGROUND_COLOR,
                  backgroundColor: FOREGROUND_COLOR,
                }}
              >
                {">"} {displayPath}
              </Span>
            ) : (
              <Span>
                {"  "} {displayPath}
              </Span>
            )}
          </TerminalFlex>
        );
      })}
    </TerminalFlex>
  );
}
