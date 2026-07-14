import React from "react";
import figures from "figures";
import { Div, Span } from "paintcannon-react";
export type Props = {
  readonly isSelected?: boolean;
};
function Indicator({ isSelected = false }: Props) {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
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
    </Div>
  );
}
export default Indicator;
