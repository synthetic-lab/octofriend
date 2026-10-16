import * as React from "react";
import { Span } from "paintcannon-react";
import { SELECTED_ITEM_ACCENT_COLOR } from "../../theme.ts";
export type Props = {
  readonly isSelected?: boolean;
  readonly label: string;
};
function Item({ isSelected = false, label }: Props) {
  return (
    <Span
      style={{
        color: isSelected ? SELECTED_ITEM_ACCENT_COLOR : undefined,
      }}
    >
      {label}
    </Span>
  );
}
export default Item;
