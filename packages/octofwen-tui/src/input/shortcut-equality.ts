import {
	type AutolistShortcutType,
	HOTKEYS,
	type Hotkey,
	type Item,
	type Keymap,
	type MapShortcutType,
	type ShortcutArray,
} from "./shortcut-types.ts";

function keymapsEqual<V>(left: Keymap<V>, right: Keymap<V>): boolean {
	if (left === right) return true;
	let index = 0;
	while (index < HOTKEYS.length) {
		const hotkey = HOTKEYS[index] as Hotkey;
		const leftItem = left[hotkey];
		const rightItem = right[hotkey];
		if (leftItem !== undefined || rightItem !== undefined) {
			if (leftItem === undefined || rightItem === undefined) return false;
			if (leftItem.label !== rightItem.label) return false;
			if (!Object.is(leftItem.value, rightItem.value)) return false;
		}
		index += 1;
	}
	return true;
}

function itemListsEqual<V>(
	left: readonly Item<V>[],
	right: readonly Item<V>[],
): boolean {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const leftItem = left[index];
		const rightItem = right[index];
		if (leftItem === undefined || rightItem === undefined) return false;
		if (leftItem.label !== rightItem.label) return false;
		if (!Object.is(leftItem.value, rightItem.value)) return false;
	}
	return true;
}

function shortcutEntryEqual<V>(
	left: MapShortcutType<V> | AutolistShortcutType<V>,
	right: MapShortcutType<V> | AutolistShortcutType<V>,
): boolean {
	if (left.type !== right.type) return false;
	if (left.type === "key") {
		if (right.type !== "key") return false;
		return keymapsEqual(left.mapping, right.mapping);
	}
	if (right.type !== "auto-list") return false;
	return itemListsEqual(left.order, right.order);
}

export function shortcutArraysEqual<V>(
	left: ShortcutArray<V>,
	right: ShortcutArray<V>,
): boolean {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const leftShortcut = left[index];
		const rightShortcut = right[index];
		if (!(leftShortcut && rightShortcut)) return false;
		if (!shortcutEntryEqual(leftShortcut, rightShortcut)) return false;
	}
	return true;
}
