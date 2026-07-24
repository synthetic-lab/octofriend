import React from "react";
import { Span } from "paintcannon-react";
import { useColor } from "../theme.ts";
import { TerminalFlex } from "./terminal-flex.tsx";

export function ToolCallRow({ name, children }: { name: string; children: React.ReactNode }) {
  const themeColor = useColor();

  return (
    <TerminalFlex>
      <Span
        style={{
          color: "gray",
          flexShrink: 0,
        }}
      >
        {name}:{" "}
      </Span>
      <Span
        style={{
          color: themeColor,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </Span>
    </TerminalFlex>
  );
}
