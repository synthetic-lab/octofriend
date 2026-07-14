import React from "react";
import { Div, Span } from "paintcannon-react";
interface SuggestionListProps {
  items: string[];
  selectedIndex: number;
  onSelect: (filename: string) => void;
}
export function SuggestionList({ items, selectedIndex }: SuggestionListProps) {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
      }}
    >
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const displayPath = item.length > 50 ? "..." + item.slice(-47) : item;
        return (
          <Div
            key={item}
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
            }}
          >
            {isSelected ? (
              <Span
                style={{
                  color: "#111827",
                  backgroundColor: "#e5e7eb",
                }}
              >
                {">"} {displayPath}
              </Span>
            ) : (
              <Span>
                {"  "} {displayPath}
              </Span>
            )}
          </Div>
        );
      })}
    </Div>
  );
}
