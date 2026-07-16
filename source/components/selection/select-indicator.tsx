import React from "react";
import figures from "figures";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "../terminal-flex.tsx";
export type Props = {
  readonly isSelected?: boolean;
};
function Indicator({ isSelected = false }: Props) {
  return (
    <TerminalFlex
      style={{
        marginRight: 1,
      }}
    >
      {isSelected ? (
        <Span
          style={{
            color: "blue",
          }}
        >
          {figures.pointer}
        </Span>
      ) : (
        <Span> </Span>
      )}
    </TerminalFlex>
  );
}
export default Indicator;
