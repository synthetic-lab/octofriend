import React from "react";
import { Box, Text } from "ink";
import { Octo } from "../octo.tsx";
import { Item, KbShortcutSelect, ShortcutArray } from "./kb-shortcut-select.tsx";

type KbPanelProps<V> = {
  shortcutItems: ShortcutArray<V>;
  readonly onSelect: (item: Item<V>) => any;
  title: string;
  children?: React.ReactNode;
};

export const MenuHeader = React.memo(({ title }: { title: string }) => {
  return (
    <Box justifyContent="center" marginBottom={1}>
      <Box justifyContent="center" width={80}>
        <Octo />
        <Box marginLeft={1}>
          <Text>{title}</Text>
        </Box>
      </Box>
    </Box>
  );
});

export function KbShortcutPanel<V>({ shortcutItems, onSelect, title, children }: KbPanelProps<V>) {
  return (
    <Box flexDirection="column">
      <MenuHeader title={title} />
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
