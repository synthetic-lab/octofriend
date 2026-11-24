import React from "react";
import { useTerminalFocus } from "../hooks/use-terminal-focus.ts";
import { BACKGROUND_COLOR, DIMMED_BACKGROUND_COLOR } from "../theme.ts";
import { TerminalFlex } from "./terminal-flex.tsx";

type Props = {
  children: React.ReactNode;
};

export function AppShell({ children }: Props) {
  const hasFocus = useTerminalFocus();
  const backgroundColor = hasFocus ? BACKGROUND_COLOR : DIMMED_BACKGROUND_COLOR;
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: 1,
      }}
    >
      <TerminalFlex
        style={{
          flexDirection: "column",
          flexGrow: 1,
          flexShrink: 1,
          flexBasis: 0,
          minWidth: 0,
          minHeight: 0,
          border: "chunky-rounded",
          borderColor: backgroundColor,
          backgroundColor,
        }}
      >
        {children}
      </TerminalFlex>
    </TerminalFlex>
  );
}
