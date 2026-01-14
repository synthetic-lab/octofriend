import React, { useState, useEffect, useRef, useMemo } from "react";
import { isDeepStrictEqual } from "node:util";
import { Box, Text, useInput } from "ink";
import { IndicatorComponent } from "./select.tsx";
import { Octo } from "./octo.tsx";
import { useColor } from "../theme.ts";

export type Item<V> = {
  label: string;
  value: V;
};
type KbPanelProps<V> = {
  shortcutItems: Record<string, Item<V>>;
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

function UnderlineItem({
  isSelected = false,
  label,
  shortcut,
}: {
  isSelected: boolean;
  label: string;
  shortcut: string;
}) {
  const themeColor = useColor();
  const color = isSelected ? themeColor : undefined;
  return (
    <>
      <Text color={color}>{label}</Text>
      <Text> </Text>
      <Text color="gray">({shortcut})</Text>
    </>
  );
}

export function KbShortcutPanel<V>({ shortcutItems, onSelect, title, children }: KbPanelProps<V>) {
  let items = useMemo(() => {
    return Object.entries(shortcutItems).map(([k, v]) => {
      return {
        item: v,
        shortcut: k,
      };
    });
  }, [shortcutItems]);

  const initialIndex = 0;
  const lastIndex = items.length - 1;
  const [rotateIndex, setRotateIndex] = useState(
    initialIndex > lastIndex ? lastIndex - initialIndex : 0,
  );
  const [selectedIndex, setSelectedIndex] = useState(
    initialIndex ? (initialIndex > lastIndex ? lastIndex : initialIndex) : 0,
  );
  const previousItems = useRef(items);

  useEffect(() => {
    if (
      !isDeepStrictEqual(
        previousItems.current.map(item => item.item.value),
        items.map(item => item.item.value),
      )
    ) {
      setRotateIndex(0);
      setSelectedIndex(0);
    }

    previousItems.current = items;
  }, [items]);

  useInput((input, key) => {
    for (const item of items) {
      if (item.shortcut.toLowerCase() === input.toLowerCase()) {
        onSelect(item.item);
        return;
      }
    }
    if (input === "k" || key.upArrow) {
      const lastIndex = items.length - 1;
      const atFirstIndex = selectedIndex === 0;
      const nextIndex = lastIndex;
      const nextRotateIndex = atFirstIndex ? rotateIndex + 1 : rotateIndex;
      const nextSelectedIndex = atFirstIndex ? nextIndex : selectedIndex - 1;

      setRotateIndex(nextRotateIndex);
      setSelectedIndex(nextSelectedIndex);
    }

    if (input === "j" || key.downArrow) {
      const atLastIndex = selectedIndex === items.length - 1;
      const nextIndex = 0;
      const nextRotateIndex = atLastIndex ? rotateIndex - 1 : rotateIndex;
      const nextSelectedIndex = atLastIndex ? nextIndex : selectedIndex + 1;

      setRotateIndex(nextRotateIndex);
      setSelectedIndex(nextSelectedIndex);
    }

    if (key.return) {
      if (typeof onSelect === "function") {
        onSelect(items[selectedIndex].item!);
      }
    }
  });

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
        <Box flexDirection="column">
          {items.map((item, index) => {
            const isSelected = index === selectedIndex;

            return (
              // @ts-expect-error - `key` can't be optional but `item.value` is generic T
              <Box key={item.key ?? item.value}>
                <IndicatorComponent isSelected={isSelected} />
                <UnderlineItem
                  isSelected={isSelected}
                  label={item.item.label}
                  shortcut={item.shortcut}
                />
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
