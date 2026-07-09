import type { Dispatch, SetStateAction } from "react";
import {
	countRenderableShortcutItems,
	type Item,
	PAGE_SIZE,
	type RenderedShortcutItem,
	type ShortcutArray,
} from "./shortcut-types.ts";

function maxShortcutPage<V>(shortcutItems: ShortcutArray<V>): number {
	let maxPage = 0;
	let index = 0;
	while (index < shortcutItems.length) {
		const shortcutType = shortcutItems[index];
		if (shortcutType?.type === "auto-list") {
			const itemCount = countRenderableShortcutItems(shortcutType.order);
			if (itemCount > 0) {
				const page = Math.ceil(itemCount / PAGE_SIZE) - 1;
				if (page > maxPage) maxPage = page;
			}
		}
		index += 1;
	}
	return maxPage;
}

export function clampShortcutPage<V>(
	shortcutItems: ShortcutArray<V>,
	page: number,
): number {
	const maxPage = maxShortcutPage(shortcutItems);
	if (!(page > 0)) return 0;
	if (page > maxPage) return maxPage;
	return page;
}

export function clampSelectedShortcutIndex(
	selectedIndex: number,
	itemsLength: number,
): number {
	if (selectedIndex <= 0 || itemsLength === 0) return 0;
	return selectedIndex >= itemsLength ? itemsLength - 1 : selectedIndex;
}

export type DirectShortcutLookup<V> = ReadonlyMap<
	number,
	RenderedShortcutItem<V>
>;

export function normalizedSingleShortcutCode(input: string): number {
	if (input.length !== 1) return -1;
	const code = input.charCodeAt(0);
	return code >= 65 && code <= 90 ? code + 32 : code;
}

export function buildDirectShortcutLookup<V>(
	items: readonly RenderedShortcutItem<V>[],
): DirectShortcutLookup<V> {
	const lookup = new Map<number, RenderedShortcutItem<V>>();
	let index = 0;
	while (index < items.length) {
		const item = items[index];
		if (item !== undefined) {
			const shortcutCode = item.normalizedShortcut.charCodeAt(0);
			if (!lookup.has(shortcutCode)) lookup.set(shortcutCode, item);
		}
		index += 1;
	}
	return lookup;
}

export function handlePageShortcutLookup<V>(
	input: string,
	lookup: DirectShortcutLookup<V>,
	page: number,
	setPage: Dispatch<SetStateAction<number>>,
	setSelectedIndex: Dispatch<SetStateAction<number>>,
): boolean {
	const direction = input === "l" ? 1 : input === "h" ? -1 : 0;
	if (direction === 0) return false;
	if (direction === -1 && page <= 0) return false;
	const shortcutItem = lookup.get(direction === 1 ? 108 : 104);
	if (shortcutItem?.isNavItem !== true) return false;

	setPage((prev) => prev + direction);
	setSelectedIndex(0);
	return true;
}

export function handleDirectShortcutLookup<V>(
	input: string,
	lookup: DirectShortcutLookup<V>,
	handleSelect: (item: Item<V | "next-page" | "prev-page">) => void,
): boolean {
	const inputCode = normalizedSingleShortcutCode(input);
	if (inputCode === -1) return false;
	const shortcutItem = lookup.get(inputCode);
	if (shortcutItem === undefined) return false;

	handleSelect(shortcutItem.item);
	return true;
}

export function handleSelectionMovement(
	input: string,
	key: { upArrow: boolean; downArrow: boolean },
	itemsLength: number,
	selectedIndex: number,
	setSelectedIndex: Dispatch<SetStateAction<number>>,
): boolean {
	if (itemsLength === 0) return false;
	if (
		itemsLength === 1 &&
		(input === "k" || key.upArrow || input === "j" || key.downArrow)
	) {
		return true;
	}

	if (input === "k" || key.upArrow) {
		const atFirstIndex = selectedIndex === 0;
		setSelectedIndex(atFirstIndex ? itemsLength - 1 : selectedIndex - 1);
		return true;
	}
	if (input === "j" || key.downArrow) {
		const atLastIndex = selectedIndex === itemsLength - 1;
		setSelectedIndex(atLastIndex ? 0 : selectedIndex + 1);
		return true;
	}
	return false;
}
