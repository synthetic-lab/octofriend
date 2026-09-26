import React, { Fragment, useMemo, useState } from "react";
import { IndicatorComponent } from "../select.tsx";
import { useColor } from "../../theme.ts";

// Allowable A-Z hotkeys, minus reserved keys
import { Span } from "paintcannon-react";
import { useKeyboard } from "../../hooks/use-keyboard.ts";
import { TerminalFlex } from "../terminal-flex.tsx";
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
  spaceAbove?: number;
  label: React.ReactNode;
  value: V;
};

/*
 * Keyboard shortcuts can come in two varieties:
 *
 * 1. A-Z predefined key mappings. For any UI elements controlled by us, we should assign a static
 * a-z hotkey to trigger the UI element.
 *
 * 2. Automatic numeric, paginated hotkeys for lists. If there's a list in the UI whose elements we
 * don't fully control, which can grow or shrink, we can't pre-assign a-z hotkeys to the list
 * elements since we don't know what they are or how many of them there are. Instead, we paginate
 * them as necessary and assign 0-9 hotkeys per page.
 * A list can be flat or divided into titled sections that share the same pagination and shortcuts.
 * Section headings do not consume shortcuts or participate in keyboard navigation. Sections
 * without items are omitted.
 *
 * Since the paginated lists can potentially consume all hotkeys from 0-9, this means we can only
 * display one paginated list per screen (otherwise, there would be conflicting hotkeys). The tuple
 * types below help enforce at compile time that we only pass a single paginated list per select
 * input, while allowing unbounded predefined A-Z key mappings before or after the paginated list.
 */
type MapShortcutType<V> = {
  type: "key";
  mapping: Keymap<V>;
};
type AutolistShortcutType<V> = {
  type: "auto-list";
  order: Array<Item<V>>;
};
export type ShortcutSection<V> = {
  id: string;
  title: string;
  subtitle?: string;
  order: Array<Item<V>>;
};
type SectionShortcutType<V> = {
  type: "sections";
  sections: Array<ShortcutSection<V>>;
};
type PaginatedMenuGroup<V> = AutolistShortcutType<V> | SectionShortcutType<V>;
export type ShortcutArray<V> =
  | []
  | [MapShortcutType<V>]
  | [PaginatedMenuGroup<V>]
  | [MapShortcutType<V>, PaginatedMenuGroup<V>]
  | [PaginatedMenuGroup<V>, MapShortcutType<V>]
  | [MapShortcutType<V>, PaginatedMenuGroup<V>, MapShortcutType<V>];
type KbSelectProps<V> = {
  shortcutItems: ShortcutArray<V>;
  actions?: Keymap<V>;
  readonly onSelect: (item: Item<V>) => any;
};
type ShortcutItem<V> = (
  | { item: Item<V>; isNavItem?: false }
  | { item: Item<"next-page" | "prev-page">; isNavItem: true }
) & {
  shortcut: string;
  section?: ShortcutSection<V>;
  spaceAbove: number;
};

const PAGE_SIZE = 10;

function keyItems<V>(mapping: Keymap<V>, spaceAbove: number): Array<ShortcutItem<V>> {
  return Object.entries(mapping).map(([k, v], index) => {
    if (k === "j" || k === "k" || k === "h" || k === "l") {
      throw new Error("Can't use j, k, h, or l as shortcuts: reserved for nav");
    }
    return { item: v, shortcut: k, spaceAbove: v.spaceAbove ?? (index === 0 ? spaceAbove : 0) };
  });
}

export function useShortcutMenu<V>({ shortcutItems, actions, onSelect }: KbSelectProps<V>) {
  const [navigation, setNavigation] = useState<{ page: number; shortcut: string | null }>({
    page: 0,
    shortcut: null,
  });
  const { rows, footerRows, page } = useMemo(() => {
    const result: Array<ShortcutItem<V>> = [];
    const footerRows: Array<ShortcutItem<V>> = [];
    let page = 0;
    let nextSpaceAbove = 0;
    shortcutItems.forEach(shortcutType => {
      if (shortcutType.type === "key") {
        const items = keyItems(shortcutType.mapping, nextSpaceAbove);
        result.push(...items);
        if (items.length > 0) nextSpaceAbove = 0;
      } else {
        const order: Array<{ item: Item<V>; section?: ShortcutSection<V> }> =
          shortcutType.type === "auto-list"
            ? shortcutType.order.map(item => ({ item }))
            : shortcutType.sections.flatMap(section =>
                section.order.map(item => ({ item, section })),
              );
        const totalItems = order.length;
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);
        page = Math.min(navigation.page, Math.max(0, totalPages - 1));
        const hasPrev = page > 0;
        const hasNext = page < totalPages - 1;
        const start = page * PAGE_SIZE;
        const end = Math.min(start + PAGE_SIZE, totalItems);
        const pageItems = order.slice(start, end);
        pageItems.forEach(({ item, section }, index) => {
          result.push({
            item: item,
            shortcut: `${index}`,
            section: section?.id !== pageItems[index - 1]?.section?.id ? section : undefined,
            spaceAbove: item.spaceAbove ?? 0,
          });
        });
        nextSpaceAbove = shortcutType.type === "sections" && pageItems.length > 0 ? 1 : 0;
        if (hasPrev) {
          footerRows.push({
            item: {
              label: "Previous page",
              value: "prev-page",
            },
            shortcut: "h",
            isNavItem: true,
            spaceAbove: 0,
          });
        }
        if (hasNext) {
          footerRows.push({
            item: {
              label: "Next page",
              value: "next-page",
            },
            shortcut: "l",
            isNavItem: true,
            spaceAbove: 0,
          });
        }
      }
    });
    if (actions) footerRows.push(...keyItems(actions, 0));
    return { rows: result, footerRows, page };
  }, [shortcutItems, actions, navigation.page]);
  if (page !== navigation.page) setNavigation({ page, shortcut: null });
  const items = [...rows, ...footerRows];
  const focused = items.find(item => item.shortcut === navigation.shortcut) ?? items[0];

  function handleSelect(item: ShortcutItem<V>) {
    if (item.isNavItem) {
      setNavigation({
        page: page + (item.item.value === "next-page" ? 1 : -1),
        shortcut: null,
      });
    } else {
      onSelect(item.item);
    }
  }

  useKeyboard(event => {
    if (event.ctrlKey) return;
    for (const item of items) {
      if (item.shortcut.toLowerCase() === event.key.toLowerCase()) {
        event.preventDefault();
        handleSelect(item);
        return;
      }
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (focused) handleSelect(focused);
      return;
    }
    const direction =
      event.key === "j" || event.key === "ArrowDown"
        ? 1
        : event.key === "k" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (direction === 0 || !focused) return;
    event.preventDefault();
    const index = items.indexOf(focused);
    const next = items[(index + direction + items.length) % items.length];
    setNavigation({ page, shortcut: next.shortcut });
  });

  return { rows, footerRows, focused };
}

export function KbShortcutSelect<V>(props: KbSelectProps<V>) {
  const { rows, footerRows, focused } = useShortcutMenu(props);
  return <KbShortcutRows rows={[...rows, ...footerRows]} focused={focused} />;
}

export function KbShortcutRows<V>({
  rows: items,
  focused,
}: {
  rows: Array<ShortcutItem<V>>;
  focused: ShortcutItem<V> | undefined;
}) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        flexShrink: 0,
        minWidth: 0,
      }}
    >
      {items.map(item => {
        const isSelected = item === focused;
        return (
          <Fragment key={item.shortcut}>
            {item.section && (
              <TerminalFlex
                style={{ flexDirection: "column", flexShrink: 0, marginTop: 1, marginBottom: 1 }}
              >
                <Span style={{ fontWeight: "bold" }}>{item.section.title}</Span>
                {item.section.subtitle && (
                  <Span style={{ color: "gray" }}>{item.section.subtitle}</Span>
                )}
              </TerminalFlex>
            )}
            <TerminalFlex style={{ marginTop: item.spaceAbove, flexShrink: 0 }}>
              <IndicatorComponent isSelected={isSelected} />
              <UnderlineItem
                isSelected={isSelected}
                label={item.item.label}
                shortcut={item.shortcut}
              />
            </TerminalFlex>
          </Fragment>
        );
      })}
    </TerminalFlex>
  );
}
function UnderlineItem({
  isSelected,
  label,
  shortcut,
}: {
  isSelected: boolean;
  label: React.ReactNode;
  shortcut: string;
}) {
  const themeColor = useColor();
  const color = isSelected ? themeColor : undefined;
  const isNumeric = !isNaN(parseInt(shortcut, 10));
  if (isNumeric) {
    return (
      <>
        <Span
          style={{
            color: "gray",
          }}
        >
          {shortcut}:
        </Span>
        <Span> </Span>
        <Span
          style={{
            color: color,
          }}
        >
          {label}
        </Span>
      </>
    );
  }
  return (
    <>
      <Span
        style={{
          color: color,
        }}
      >
        {label}
      </Span>
      <Span> </Span>
      <Span
        style={{
          color: "gray",
        }}
      >
        ({shortcut})
      </Span>
    </>
  );
}
