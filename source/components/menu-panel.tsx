import React from "react";
import SelectInput from "./selection/select-input.tsx";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Octo } from "./octo.tsx";
import { Div, Span } from "paintcannon-react";
type Item<V> = {
  label: string;
  value: V;
};
type MenuPanelProps<V> = {
  items: Array<Item<V>>;
  readonly onSelect: (item: Item<V>) => any;
  title: string;
  children?: React.ReactNode;
};
export const MenuHeader = ({ title }: { title: string }) => {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        justifyContent: "center",
        marginBottom: 1,
      }}
    >
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          justifyContent: "center",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        <Octo />
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            marginLeft: 1,
          }}
        >
          <Span>{title}</Span>
        </Div>
      </Div>
    </Div>
  );
};
export function MenuPanel<V>({ items, onSelect, title, children }: MenuPanelProps<V>) {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
      }}
    >
      <MenuHeader title={title} />
      {children && (
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 1,
          }}
        >
          <Div
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
              flexDirection: "column",
              width: "100%",
              minWidth: 0,
              maxWidth: 80,
            }}
          >
            {children}
          </Div>
        </Div>
      )}
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          justifyContent: "center",
        }}
      >
        <SelectInput
          items={items}
          onSelect={onSelect}
          indicatorComponent={IndicatorComponent}
          itemComponent={ItemComponent}
        />
      </Div>
    </Div>
  );
}
