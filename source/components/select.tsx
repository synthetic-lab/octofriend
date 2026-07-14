import React from "react";
import { useColor } from "../theme.ts";
import figures from "figures";
import { Div, Span } from "paintcannon-react";
export const IndicatorComponent = ({ isSelected = false }: { isSelected?: boolean }) => {
  const themeColor = useColor();
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
            color: themeColor,
          }}
        >
          {figures.pointer}
        </Span>
      ) : (
        <Span> </Span>
      )}
    </Div>
  );
};
export const ItemComponent = ({
  isSelected = false,
  label,
}: {
  isSelected?: boolean;
  label: string;
}) => {
  const themeColor = useColor();
  return (
    <Span
      style={{
        color: isSelected ? themeColor : undefined,
      }}
    >
      {label}
    </Span>
  );
};
