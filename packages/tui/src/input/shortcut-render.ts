import { shortcutArraysEqual as shortcutArraysEqualImpl } from "./shortcut-eq";
import {
	buildDirectShortcutLookup as buildDirectShortcutLookupImpl,
	clampSelectedShortcutIndex as clampSelectedShortcutIndexImpl,
	clampShortcutPage as clampShortcutPageImpl,
	type DirectShortcutLookup as DirectShortcutLookupType,
	handleDirectShortcutLookup as handleDirectShortcutLookupImpl,
	handlePageShortcutLookup as handlePageShortcutLookupImpl,
	handleSelectionMovement as handleSelectionMovementImpl,
	normalizedSingleShortcutCode,
} from "./shortcut-nav";
import { renderShortcutItems as renderShortcutItemsImpl } from "./shortcut-items";
import type {
	AutolistShortcutType as AutolistShortcutTypeType,
	Hotkey as HotkeyType,
	Item as ItemType,
	Keymap as KeymapType,
	MapShortcutType as MapShortcutTypeType,
	RenderedShortcutItem as RenderedShortcutItemType,
	ShortcutArray as ShortcutArrayType,
} from "./shortcut-types";

type Item<V> = ItemType<V>;
type RenderedShortcutItem<V> = RenderedShortcutItemType<V>;
export type AutolistShortcutType<V> = AutolistShortcutTypeType<V>;
export type DirectShortcutLookup<V> = DirectShortcutLookupType<V>;
export type Hotkey = HotkeyType;
export type Keymap<V> = KeymapType<V>;
export type MapShortcutType<V> = MapShortcutTypeType<V>;
export type ShortcutArray<V> = ShortcutArrayType<V>;
export type { Item, RenderedShortcutItem };

export const shortcutArraysEqual = shortcutArraysEqualImpl;
export const renderShortcutItems = renderShortcutItemsImpl;
export const buildDirectShortcutLookup = buildDirectShortcutLookupImpl;
export const clampSelectedShortcutIndex = clampSelectedShortcutIndexImpl;
export const clampShortcutPage = clampShortcutPageImpl;
export const handleDirectShortcutLookup = handleDirectShortcutLookupImpl;
export const handlePageShortcutLookup = handlePageShortcutLookupImpl;
export const handleSelectionMovement = handleSelectionMovementImpl;

function findShortcutItem<V>(
	items: readonly RenderedShortcutItem<V>[],
	input: string,
): RenderedShortcutItem<V> | undefined {
	const inputCode = normalizedSingleShortcutCode(input);
	if (inputCode === -1) return undefined;
	let index = 0;
	while (index < items.length) {
		const item = items[index];
		if (
			item !== undefined &&
			item.normalizedShortcut.charCodeAt(0) === inputCode
		) {
			return item;
		}
		index += 1;
	}
	return undefined;
}

export function handleDirectShortcut<V>(
	input: string,
	items: readonly RenderedShortcutItem<V>[],
	handleSelect: (item: Item<V | "next-page" | "prev-page">) => void,
): boolean {
	const shortcutItem = findShortcutItem(items, input);
	if (!shortcutItem) return false;

	handleSelect(shortcutItem.item);
	return true;
}
