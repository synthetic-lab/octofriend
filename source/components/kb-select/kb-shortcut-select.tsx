import React, { useEffect, useRef, useState, type RefObject } from "react";
import { IntersectionObserver, type DivElement } from "paintcannon";
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
  spaceBefore?: number;
  unindented?: boolean;
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
type PageEntry<V> = {
  item: Item<V>;
  section: ShortcutSection<V> | null;
};
type ActionRow<V> = (
  | { type: "item"; shortcut: string; item: Item<V> }
  | { type: "page"; shortcut: string; label: string; page: number }
) & { spaceBefore: number };
type MenuRow<V> = ActionRow<V> | { type: "heading"; section: ShortcutSection<V> };

const PAGE_SIZE = 10;

function paginate<V>(group: PaginatedMenuGroup<V>): Array<Array<PageEntry<V>>> {
  const entries: Array<PageEntry<V>> =
    group.type === "auto-list"
      ? group.order.map(item => ({ item, section: null }))
      : group.sections.flatMap(section => section.order.map(item => ({ item, section })));
  const pages: Array<Array<PageEntry<V>>> = [];
  for (let start = 0; start < entries.length; start += PAGE_SIZE) {
    pages.push(entries.slice(start, start + PAGE_SIZE));
  }
  return pages;
}

function buildRows<V>(
  shortcutItems: ShortcutArray<V>,
  entries: Array<PageEntry<V>>,
): Array<MenuRow<V>> {
  const rows: Array<MenuRow<V>> = [];
  let nextSpaceBefore = 0;
  for (const group of shortcutItems) {
    if (group.type === "key") {
      for (const [shortcut, item] of Object.entries(group.mapping)) {
        if (shortcut === "j" || shortcut === "k" || shortcut === "h" || shortcut === "l") {
          throw new Error("Can't use j, k, h, or l as shortcuts: reserved for nav");
        }
        rows.push({
          type: "item",
          shortcut,
          item,
          spaceBefore: item.spaceBefore ?? nextSpaceBefore,
        });
        nextSpaceBefore = 0;
      }
      continue;
    }
    let sectionId: string | null = null;
    entries.forEach(({ item, section }, index) => {
      if (section && section.id !== sectionId) {
        rows.push({ type: "heading", section });
        sectionId = section.id;
      }
      rows.push({
        type: "item",
        shortcut: String(index),
        item,
        spaceBefore: item.spaceBefore ?? 0,
      });
    });
    nextSpaceBefore = group.type === "sections" && entries.length > 0 ? 1 : 0;
  }
  return rows;
}

export function useShortcutMenu<V>({
  shortcutItems,
  actions,
  onSelect,
  viewportRef,
}: KbSelectProps<V> & { viewportRef?: RefObject<DivElement | null> }) {
  const [navigation, setNavigation] = useState<{ page: number; shortcut: string | null }>({
    page: 0,
    shortcut: null,
  });
  const group = shortcutItems.find(group => group.type !== "key");
  const pages = group && group.type !== "key" ? paginate(group) : [];
  const page = Math.min(navigation.page, Math.max(0, pages.length - 1));
  if (page !== navigation.page) setNavigation({ page, shortcut: null });
  const rows = buildRows(shortcutItems, pages[page] ?? []);
  const footerRows: Array<MenuRow<V>> = [];
  if (page > 0) {
    footerRows.push({
      type: "page",
      shortcut: "h",
      label: "Previous page",
      page: page - 1,
      spaceBefore: 0,
    });
  }
  if (page < pages.length - 1) {
    footerRows.push({
      type: "page",
      shortcut: "l",
      label: "Next page",
      page: page + 1,
      spaceBefore: 0,
    });
  }
  if (actions) footerRows.push(...buildRows([{ type: "key", mapping: actions }], []));
  const selectableRows = [...rows, ...footerRows].filter(
    (row): row is ActionRow<V> => row.type !== "heading",
  );
  const focused =
    selectableRows.find(row => row.shortcut === navigation.shortcut) ?? selectableRows[0];

  function activate(row: ActionRow<V>) {
    if (row.type === "page") {
      setNavigation({ page: row.page, shortcut: null });
    } else {
      onSelect(row.item);
    }
  }

  useKeyboard(event => {
    if (event.ctrlKey) return;
    const viewport = viewportRef?.current;
    if (viewport && (event.key === "PageUp" || event.key === "PageDown")) {
      event.preventDefault();
      viewport.scrollTop += (event.key === "PageDown" ? 1 : -1) * viewport.clientHeight;
      return;
    }
    const shortcut = selectableRows.find(row => row.shortcut === event.key.toLowerCase());
    if (shortcut) {
      event.preventDefault();
      activate(shortcut);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (focused) activate(focused);
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
    const index = selectableRows.indexOf(focused);
    const next =
      selectableRows[(index + direction + selectableRows.length) % selectableRows.length];
    setNavigation({ page, shortcut: next.shortcut });
  });

  return { rows, footerRows, focused };
}

export function KbShortcutSelect<V>(props: KbSelectProps<V>) {
  const { rows, footerRows, focused } = useShortcutMenu(props);
  return <KbShortcutRows rows={[...rows, ...footerRows]} focused={focused} />;
}

export function KbShortcutRows<V>({
  rows,
  focused,
  viewportRef,
}: {
  rows: Array<MenuRow<V>>;
  focused: ActionRow<V> | undefined;
  viewportRef?: RefObject<DivElement | null>;
}) {
  const focusedRef = useRef<DivElement>(null);
  useEffect(() => {
    const viewport = viewportRef?.current;
    const element = focusedRef.current;
    if (!viewport || !element) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const bounds = entry.rootBounds;
          if (!bounds) continue;
          const row = entry.boundingClientRect;
          if (row.top < bounds.top) {
            viewport.scrollTop += row.top - bounds.top;
          } else if (row.bottom > bounds.bottom) {
            viewport.scrollTop += Math.min(row.top - bounds.top, row.bottom - bounds.bottom);
          }
        }
        observer.disconnect();
      },
      { root: viewport, threshold: 1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [focused, viewportRef]);

  return (
    <TerminalFlex style={{ flexDirection: "column", flexShrink: 0, minWidth: 0 }}>
      {rows.map(row => {
        if (row.type === "heading") {
          return (
            <TerminalFlex
              key={`section:${row.section.id}`}
              style={{ flexDirection: "column", flexShrink: 0, marginTop: 1, marginBottom: 1 }}
            >
              <Span style={{ fontWeight: "bold" }}>{row.section.title}</Span>
              {row.section.subtitle && (
                <Span style={{ color: "gray" }}>{row.section.subtitle}</Span>
              )}
            </TerminalFlex>
          );
        }
        const isSelected = row === focused;
        return (
          <TerminalFlex
            key={row.shortcut}
            ref={isSelected ? focusedRef : undefined}
            style={{ marginTop: row.spaceBefore, flexShrink: 0 }}
          >
            {!(row.type === "item" && row.item.unindented) && (
              <IndicatorComponent isSelected={isSelected} />
            )}
            <UnderlineItem
              isSelected={isSelected}
              label={row.type === "item" ? row.item.label : row.label}
              shortcut={row.shortcut}
            />
          </TerminalFlex>
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
