import React from "react";
import { TerminalFlex } from "./terminal-flex.tsx";
export const CenteredBox = ({ children }: { children?: React.ReactNode }) => {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        alignItems: "center",
        height: "100%",
      }}
    >
      <TerminalFlex
        style={{
          flexDirection: "column",
          justifyContent: "center",
          height: "100%",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        {children}
      </TerminalFlex>
    </TerminalFlex>
  );
};
export const HeightlessCenteredBox = ({ children }: { children?: React.ReactNode }) => {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <TerminalFlex
        style={{
          flexDirection: "column",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        {children}
      </TerminalFlex>
    </TerminalFlex>
  );
};
