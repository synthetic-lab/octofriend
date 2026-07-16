import * as React from "react";
import { Span } from "paintcannon-react";
export type Props = {
  readonly isSelected?: boolean;
  readonly label: string;
};
function Item({ isSelected = false, label }: Props) {
  return (
    <Span
      style={{
        color: isSelected ? "blue" : undefined,
      }}
    >
      {label}
    </Span>
  );
}
export default Item;
