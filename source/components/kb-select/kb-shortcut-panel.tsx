import React from "react";
import { Octo } from "../octo.tsx";
import { Item, KbShortcutSelect, ShortcutArray } from "./kb-shortcut-select.tsx";
import { Div, Span } from "paintcannon-react";
type KbPanelProps<V> = {
  shortcutItems: ShortcutArray<V>;
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
export function KbShortcutPanel<V>({ shortcutItems, onSelect, title, children }: KbPanelProps<V>) {
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
        <KbShortcutSelect shortcutItems={shortcutItems} onSelect={onSelect} />
      </Div>
    </Div>
  );
}
