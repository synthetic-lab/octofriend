import React from "react";
import { Div, type DivElement, type DivProps } from "paintcannon-react";

export const TerminalFlex = React.forwardRef<DivElement, DivProps>(function TerminalFlex(
  { style, ...props },
  ref,
) {
  return (
    <Div
      ref={ref}
      {...props}
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        ...style,
      }}
    />
  );
});
