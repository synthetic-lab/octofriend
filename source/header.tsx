import React from "react";
import figlet from "figlet";
import { color } from "./theme.ts";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./components/terminal-flex.tsx";
type HeaderProps = {
  unchained: boolean;
};
export const Header = ({ unchained }: HeaderProps) => {
  const font: figlet.Fonts = "Delta Corps Priest 1";
  const top = figlet.textSync("Octo", {
    font,
  });
  const bottom = figlet.textSync("Friend", {
    font,
  });
  const themeColor = color(unchained);
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <Span
        style={{
          color: themeColor,
          whiteSpace: "pre",
        }}
      >
        {top}
      </Span>
      <Span style={{ whiteSpace: "pre" }}>{bottom}</Span>
    </TerminalFlex>
  );
};
