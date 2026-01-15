import React, { useState, useEffect, useRef, useMemo } from "react";
import { isDeepStrictEqual } from "node:util";
import { Box, Text, useInput } from "ink";
import { IndicatorComponent } from "../select.tsx";
import { useColor } from "../../theme.ts";

export type Item<V> = {
  label: string;
  value: V;
};
type MapShortcutType<V> = {
  type: "key";
  mapping: Record<string, Item<V>>;
};
type NumberShortcutType<V> = {
  type: "number";
  order: Array<Item<V>>;
};

export type ShortcutArray<V> =
  | [MapShortcutType<V>]
  | [NumberShortcutType<V>]
  | [MapShortcutType<V>, NumberShortcutType<V>]
  | [NumberShortcutType<V>, MapShortcutType<V>]
  | [MapShortcutType<V>, NumberShortcutType<V>, MapShortcutType<V>];

type KbSelectProps<V> = {
  shortcutItems: ShortcutArray<V>;
  readonly onSelect: (item: Item<V>) => any;
};
export function KbShortcutSelect<V>({ shortcutItems, onSelect }: KbSelectProps<V>) {
  let items = useMemo(() => {
    return shortcutItems.flatMap(shortcutType => {
      if (shortcutType.type === "key") {
        return Object.entries(shortcutType.mapping).map(([k, v]) => {
          if (k === "j" || k === "k") {
            throw new Error("Can't use j or k as shortcuts: reserved for nav");
          }
          return {
            item: v,
            shortcut: k,
          };
        });
      }
      return shortcutType.order.map((item, index) => {
        return {
          item: item,
          shortcut: `${index}`,
        };
      });
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
  );
}

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
