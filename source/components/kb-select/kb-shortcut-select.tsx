import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { isDeepStrictEqual } from "node:util";
import { Box, Text, useInput } from "ink";
import { IndicatorComponent } from "../select.tsx";
import { useColor } from "../../theme.ts";

export type Hotkey =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "i"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

export type Keymap<V> = Partial<Record<Hotkey, Item<V>>>;

export type Item<V> = {
  label: string;
  value: V;
};
type MapShortcutType<V> = {
  type: "key";
  mapping: Keymap<V>;
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
const PAGE_SIZE = 10;
export function KbShortcutSelect<V>({ shortcutItems, onSelect }: KbSelectProps<V>) {
  const [page, setPage] = useState(0);

  let items = useMemo(() => {
    const result: Array<{
      item: Item<V | "next-page" | "prev-page">;
      shortcut: string;
      isNavItem?: boolean;
    }> = [];

    shortcutItems.forEach(shortcutType => {
      if (shortcutType.type === "key") {
        Object.entries(shortcutType.mapping).forEach(([k, v]) => {
          if (k === "j" || k === "k" || k === "h" || k === "l") {
            throw new Error("Can't use j, k, h, or l as shortcuts: reserved for nav");
          }
          result.push({
            item: v,
            shortcut: k,
          });
        });
      } else {
        const totalItems = shortcutType.order.length;
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);
        const hasPrev = page > 0;
        const hasNext = page < totalPages - 1;

        const start = page * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, totalItems);
        const pageItems = shortcutType.order.slice(start, end);

        pageItems.forEach((item, index) => {
          result.push({
            item: item,
            shortcut: `${index}`,
          });
        });

        if (hasPrev) {
          result.push({
            item: { label: "Previous page", value: "prev-page" },
            shortcut: "h",
            isNavItem: true,
          });
        }
        if (hasNext) {
          result.push({
            item: { label: "Next page", value: "next-page" },
            shortcut: "l",
            isNavItem: true,
          });
        }
      }
    });

    return result;
  }, [shortcutItems, page]);

  const initialIndex = 0;
  const lastIndex = items.length - 1;
  const [rotateIndex, setRotateIndex] = useState(
    initialIndex > lastIndex ? lastIndex - initialIndex : 0,
  );
  const [selectedIndex, setSelectedIndex] = useState(
    initialIndex ? (initialIndex > lastIndex ? lastIndex : initialIndex) : 0,
  );
  const previousShortcutItems = useRef(shortcutItems);

  useEffect(() => {
    if (!isDeepStrictEqual(previousShortcutItems.current, shortcutItems)) {
      setRotateIndex(0);
      setSelectedIndex(0);
      setPage(0);
    }

    previousShortcutItems.current = shortcutItems;
  }, [shortcutItems]);

  const handleSelect = useCallback(
    (item: Item<V | "next-page" | "prev-page">) => {
      if (item.value === "next-page" || item.value === "prev-page") {
        return;
      }
      onSelect(item as Item<V>);
    },
    [onSelect],
  );

  useInput((input, key) => {
    if (input === "l") {
      const hasNext = items.some(item => item.shortcut === "l" && item.isNavItem);
      if (hasNext) {
        setPage(prev => prev + 1);
        setSelectedIndex(0);
        setRotateIndex(0);
        return;
      }
    }
    if (input === "h") {
      const hasPrev = items.some(item => item.shortcut === "h" && item.isNavItem);
      if (hasPrev && page > 0) {
        setPage(prev => prev - 1);
        setSelectedIndex(0);
        setRotateIndex(0);
        return;
      }
    }

    for (const item of items) {
      if (item.shortcut.toLowerCase() === input.toLowerCase()) {
        handleSelect(item.item);
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
      handleSelect(items[selectedIndex].item);
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
  const isNumeric = !isNaN(parseInt(shortcut, 10));

  if (isNumeric) {
    return (
      <>
        <Text color="gray">{shortcut}:</Text>
        <Text> </Text>
        <Text color={color}>{label}</Text>
      </>
    );
  }

  return (
    <>
      <Text color={color}>{label}</Text>
      <Text> </Text>
      <Text color="gray">({shortcut})</Text>
    </>
  );
}
