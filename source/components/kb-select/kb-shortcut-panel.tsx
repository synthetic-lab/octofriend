import React, { useRef } from "react";
import type { DivElement } from "paintcannon";
import { Octo } from "../octo.tsx";
import {
  Item,
  Keymap,
  KbShortcutRows,
  ShortcutArray,
  useShortcutMenu,
} from "./kb-shortcut-select.tsx";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "../terminal-flex.tsx";
import { SCROLLBAR_COLOR } from "../../theme.ts";
type KbPanelProps<V> = {
  shortcutItems?: ShortcutArray<V>;
  actions?: Keymap<V>;
  readonly onSelect: (item: Item<V>) => any;
  header?: React.ReactNode;
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
export function KbShortcutPanel<V>({
  shortcutItems,
  actions,
  onSelect,
  header,
  children,
}: KbPanelProps<V>) {
  const viewportRef = useRef<DivElement>(null);
  const { rows, footerRows, focused } = useShortcutMenu({
    shortcutItems: shortcutItems ?? [],
    actions,
    onSelect,
    viewportRef,
  });
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        alignSelf: "center",
        flexShrink: 1,
        minHeight: 0,
        maxHeight: "100%",
        width: "100%",
        maxWidth: 80,
        minWidth: 0,
      }}
    >
      {header != null && (
        <TerminalFlex style={{ flexDirection: "column", flexShrink: 0 }}>
          {typeof header === "string" ? <MenuHeader title={header} /> : header}
        </TerminalFlex>
      )}
      <TerminalFlex
        ref={viewportRef}
        style={{
          flexDirection: "column",
          flexShrink: 1,
          minHeight: 0,
          overflowY: "scroll",
          scrollbarGutter: "auto",
          scrollbarColor: SCROLLBAR_COLOR,
        }}
      >
        <TerminalFlex
          style={{
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          {children}
          <TerminalFlex
            style={{
              flexDirection: "column",
              flexShrink: 0,
              marginTop: children && rows.length > 0 ? 1 : 0,
            }}
          >
            <KbShortcutRows rows={rows} focused={focused} viewportRef={viewportRef} />
          </TerminalFlex>
        </TerminalFlex>
      </TerminalFlex>
      {footerRows.length > 0 && (
        <TerminalFlex style={{ flexDirection: "column", flexShrink: 0, marginTop: 1 }}>
          <KbShortcutRows rows={footerRows} focused={focused} />
        </TerminalFlex>
      )}
    </TerminalFlex>
  );
}
