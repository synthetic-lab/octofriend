import React, { useEffect, useState } from "react";
import { useApp } from "paintcannon-react";
import { BACKGROUND_COLOR, DIMMED_BACKGROUND_COLOR } from "../theme.ts";
import { TerminalFlex } from "./terminal-flex.tsx";

type Props = {
  children: React.ReactNode;
};

export function AppShell({ children }: Props) {
  const { paintCannon } = useApp();
  const [hasFocus, setHasFocus] = useState(paintCannon.hasFocus);

  useEffect(() => {
    const handleBlur = () => setHasFocus(false);
    const handleFocus = () => setHasFocus(true);

    paintCannon.addEventListener("blur", handleBlur);
    paintCannon.addEventListener("focus", handleFocus);
    return () => {
      paintCannon.removeEventListener("blur", handleBlur);
      paintCannon.removeEventListener("focus", handleFocus);
    };
  }, [paintCannon]);

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
