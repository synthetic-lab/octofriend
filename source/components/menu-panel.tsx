import React from "react";
import SelectInput from "./selection/select-input.tsx";
import { IndicatorComponent, ItemComponent } from "./select.tsx";
import { Octo } from "./octo.tsx";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
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
    <TerminalFlex
      style={{
        justifyContent: "center",
        marginBottom: 1,
      }}
    >
      <TerminalFlex
        style={{
          justifyContent: "center",
          width: "100%",
          minWidth: 0,
          maxWidth: 80,
        }}
      >
        <Octo />
        <TerminalFlex
          style={{
            marginLeft: 1,
          }}
        >
          <Span>{title}</Span>
        </TerminalFlex>
      </TerminalFlex>
    </TerminalFlex>
  );
};
export function MenuPanel<V>({ items, onSelect, title, children }: MenuPanelProps<V>) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      <MenuHeader title={title} />
      {children && (
        <TerminalFlex
          style={{
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 1,
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
      )}
      <TerminalFlex
        style={{
          justifyContent: "center",
        }}
      >
        <SelectInput
          items={items}
          onSelect={onSelect}
          indicatorComponent={IndicatorComponent}
          itemComponent={ItemComponent}
        />
      </TerminalFlex>
    </TerminalFlex>
  );
}
