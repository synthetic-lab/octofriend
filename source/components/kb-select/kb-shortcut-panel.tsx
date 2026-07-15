import React from "react";
import { Octo } from "../octo.tsx";
import { Item, KbShortcutSelect, ShortcutArray } from "./kb-shortcut-select.tsx";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "../terminal-flex.tsx";
type KbPanelProps<V> = {
  shortcutItems: ShortcutArray<V>;
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
export function KbShortcutPanel<V>({ shortcutItems, onSelect, title, children }: KbPanelProps<V>) {
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
        <KbShortcutSelect shortcutItems={shortcutItems} onSelect={onSelect} />
      </TerminalFlex>
    </TerminalFlex>
  );
}
