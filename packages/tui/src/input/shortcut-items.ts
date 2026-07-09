import {
	HOTKEYS,
	type Hotkey,
	type Item,
	isRenderableShortcutItem,
	type Keymap,
	NUMERIC_SHORTCUTS,
	PAGE_SIZE,
	type RenderedShortcutItem,
	type ShortcutArray,
} from "./shortcut-types";

const PREVIOUS_PAGE_SHORTCUT_ITEM: RenderedShortcutItem<never> = {
	item: { label: "Previous page", value: "prev-page" },
	shortcut: "h",
	normalizedShortcut: "h",
	isNavItem: true,
};
const NEXT_PAGE_SHORTCUT_ITEM: RenderedShortcutItem<never> = {
	item: { label: "Next page", value: "next-page" },
	shortcut: "l",
	normalizedShortcut: "l",
	isNavItem: true,
};

function renderKeyShortcutItems<V>(
	mapping: Keymap<V>,
	result: RenderedShortcutItem<V>[],
	writeIndex: number,
): number {
	let nextWriteIndex = writeIndex;
	let index = 0;
	while (index < HOTKEYS.length) {
		const shortcut = HOTKEYS[index] as Hotkey;
		const item = mapping[shortcut];
		if (isRenderableShortcutItem(item)) {
			result[nextWriteIndex] = {
				item,
				shortcut,
				normalizedShortcut: shortcut,
			};
			nextWriteIndex += 1;
		}
		index += 1;
	}
	return nextWriteIndex;
}

function renderAutoListShortcutItems<V>(
	order: readonly Item<V>[],
	page: number,
	result: RenderedShortcutItem<V>[],
	writeIndex: number,
): number {
	let nextWriteIndex = writeIndex;
	const pageStart = page * PAGE_SIZE;
	const pageEnd = pageStart + PAGE_SIZE;
	let renderableIndex = 0;
	for (let itemIndex = 0; itemIndex < order.length; itemIndex += 1) {
		const item = order[itemIndex];
		if (!isRenderableShortcutItem(item)) continue;
		if (renderableIndex >= pageStart && renderableIndex < pageEnd) {
			const shortcut = NUMERIC_SHORTCUTS[renderableIndex - pageStart] as string;
			result[nextWriteIndex] = { item, shortcut, normalizedShortcut: shortcut };
			nextWriteIndex += 1;
		}
		renderableIndex += 1;
	}
	const totalPages = Math.ceil(renderableIndex / PAGE_SIZE);
	if (page > 0) {
		result[nextWriteIndex] = PREVIOUS_PAGE_SHORTCUT_ITEM;
		nextWriteIndex += 1;
	}
	if (page < totalPages - 1) {
		result[nextWriteIndex] = NEXT_PAGE_SHORTCUT_ITEM;
		nextWriteIndex += 1;
	}
	return nextWriteIndex;
}

export function renderShortcutItems<V>(
	shortcutItems: ShortcutArray<V>,
	page: number,
): RenderedShortcutItem<V>[] {
	const result: RenderedShortcutItem<V>[] = [];
	let writeIndex = 0;
	let index = 0;
	while (index < shortcutItems.length) {
		const shortcutType = shortcutItems[index];
		if (shortcutType !== undefined) {
			if (shortcutType.type === "key") {
				writeIndex = renderKeyShortcutItems(
					shortcutType.mapping,
					result,
					writeIndex,
				);
			} else {
				writeIndex = renderAutoListShortcutItems(
					shortcutType.order,
					page,
					result,
					writeIndex,
				);
			}
		}
		index += 1;
	}
	return result;
}
