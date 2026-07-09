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

export type Item<V> = {
	label: string;
	value: V;
};

export type Keymap<V> = Partial<Record<Hotkey, Item<V>>>;

export type MapShortcutType<V> = {
	type: "key";
	mapping: Keymap<V>;
};

export type AutolistShortcutType<V> = {
	type: "auto-list";
	order: Item<V>[];
};

export type ShortcutArray<V> =
	| [MapShortcutType<V>]
	| [AutolistShortcutType<V>]
	| [MapShortcutType<V>, AutolistShortcutType<V>]
	| [AutolistShortcutType<V>, MapShortcutType<V>]
	| [MapShortcutType<V>, AutolistShortcutType<V>, MapShortcutType<V>];

export type RenderedShortcutItem<V> = {
	item: Item<V | "next-page" | "prev-page">;
	shortcut: string;
	normalizedShortcut: string;
	isNavItem?: boolean;
};

export const PAGE_SIZE = 10;
export const HOTKEYS: readonly Hotkey[] = [
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"i",
	"m",
	"n",
	"o",
	"p",
	"q",
	"r",
	"s",
	"t",
	"u",
	"v",
	"w",
	"x",
	"y",
	"z",
];

export const NUMERIC_SHORTCUTS = [
	"0",
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
];

export function isRenderableShortcutItem<V>(
	item: Item<V> | undefined,
): item is Item<V> {
	return item !== undefined && item.label.trim().length > 0;
}

export function countRenderableShortcutItems<V>(
	items: readonly Item<V>[],
): number {
	let count = 0;
	for (let index = 0; index < items.length; index += 1) {
		if (isRenderableShortcutItem(items[index])) count += 1;
	}
	return count;
}
