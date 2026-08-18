import React from "react";
import figlet, { type FontName } from "figlet";
import deltaCorpsPriestFont from "figlet/fonts/Delta Corps Priest 1";
import { color } from "./theme.ts";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./components/terminal-flex.tsx";

const font: FontName = "Delta Corps Priest 1";
// figlet otherwise reads font files from its own fonts/ dir, which doesn't
// exist inside compiled standalone binaries; importing the font as a module
// and registering it here keeps textSync filesystem-free.
figlet.parseFont(font, deltaCorpsPriestFont);

type HeaderProps = {
  unchained: boolean;
};
export const Header = ({ unchained }: HeaderProps) => {
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
