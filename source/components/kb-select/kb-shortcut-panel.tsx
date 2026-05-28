import React from "react";
import { Box } from "ink";
import { MenuHeader } from "../menu-panel.tsx";
import { Item, KbShortcutSelect, ShortcutArray } from "./kb-shortcut-select.tsx";

type KbPanelProps<V> = {
  shortcutItems: ShortcutArray<V>;
  readonly onSelect: (item: Item<V>) => any;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
};

export function KbShortcutPanel<V>({
  shortcutItems,
  onSelect,
  title,
  subtitle,
  children,
}: KbPanelProps<V>) {
  return (
    <Box flexDirection="column">
      {title ? <MenuHeader title={title} subtitle={subtitle} /> : null}
      {children && (
        <Box justifyContent="center" alignItems="center" marginBottom={1}>
          <Box flexDirection="column" width={80}>
            {children}
          </Box>
        </Box>
      )}
      <Box justifyContent="center">
        <KbShortcutSelect shortcutItems={shortcutItems} onSelect={onSelect} />
      </Box>
    </Box>
  );
}
