import { Box, Text } from "ink";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ThemedSelectIndicator as IndicatorComponent } from "../menu/select";
import { normalizeRenderedLineBreaks } from "../render/lines";
import { useTerminalThemeColor } from "../theme/branding";
import {
	type InkInputKey,
	useLatestInput,
	useLatestRef,
} from "./latest-input";
import {
	buildDirectShortcutLookup,
	clampSelectedShortcutIndex,
	clampShortcutPage,
	handleDirectShortcutLookup,
	handlePageShortcutLookup,
	handleSelectionMovement,
	type Item,
	type RenderedShortcutItem,
	renderShortcutItems,
	type ShortcutArray,
	shortcutArraysEqual,
} from "./shortcut-render";

export type KbSelectProps<V> = {
	shortcutItems: ShortcutArray<V>;
	onSelect: (item: Item<V>) => unknown;
};

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (value !== null && typeof value === "object") ||
		typeof value === "function"
		? typeof (value as { then?: unknown }).then === "function"
		: false;
}

export function KbShortcutSelect<V>({
	shortcutItems,
	onSelect,
}: KbSelectProps<V>) {
	const onSelectRef = useLatestRef(onSelect);
	const themeColor = useTerminalThemeColor();
	const [page, setPage] = useState(0);
	const previousShortcutItems = useRef(shortcutItems);
	const shortcutItemsChanged = !shortcutArraysEqual(
		previousShortcutItems.current,
		shortcutItems,
	);
	const stableShortcutItems = shortcutItemsChanged
		? shortcutItems
		: previousShortcutItems.current;
	const activePage = clampShortcutPage(stableShortcutItems, page);

	const items = useMemo(
		() => renderShortcutItems(stableShortcutItems, activePage),
		[stableShortcutItems, activePage],
	);
	const directShortcutLookup = useMemo(
		() => buildDirectShortcutLookup(items),
		[items],
	);

	const [selectedIndex, setSelectedIndex] = useState(0);
	const activeSelectedIndex = clampSelectedShortcutIndex(
		selectedIndex,
		items.length,
	);
	const selectingRef = useRef(false);

	useEffect(() => {
		if (shortcutItemsChanged) {
			selectingRef.current = false;
			setSelectedIndex(0);
			setPage(0);
		}

		previousShortcutItems.current = shortcutItems;
	}, [shortcutItems, shortcutItemsChanged]);

	const handleSelect = useCallback(
		(item: Item<V | "next-page" | "prev-page">) => {
			if (item.value === "next-page" || item.value === "prev-page") return;
			if (selectingRef.current) return;
			selectingRef.current = true;
			let result: unknown;
			try {
				result = onSelectRef.current(item as Item<V>);
			} catch (error) {
				selectingRef.current = false;
				throw error;
			}
			if (!isPromiseLike(result)) {
				selectingRef.current = false;
				return;
			}
			Promise.resolve(result).then(
				() => {
					selectingRef.current = false;
				},
				() => {
					selectingRef.current = false;
				},
			);
		},
		[onSelectRef],
	);

	const handleInput = useCallback(
		(input: string, key: InkInputKey) => {
			if (key.ctrl) return;

			if (
				handlePageShortcutLookup(
					input,
					directShortcutLookup,
					activePage,
					setPage,
					setSelectedIndex,
				)
			) {
				return;
			}

			if (
				handleSelectionMovement(
					input,
					key,
					items.length,
					activeSelectedIndex,
					setSelectedIndex,
				)
			) {
				return;
			}

			if (
				handleDirectShortcutLookup(input, directShortcutLookup, handleSelect)
			) {
				return;
			}

			if (key.return && items[activeSelectedIndex]) {
				handleSelect(items[activeSelectedIndex].item);
			}
		},
		[
			activePage,
			activeSelectedIndex,
			directShortcutLookup,
			handleSelect,
			items,
		],
	);

	const renderedItems = useMemo(
		() => renderShortcutSelectItems(items, activeSelectedIndex, themeColor),
		[activeSelectedIndex, items, themeColor],
	);

	useLatestInput(handleInput);

	return <Box flexDirection="column">{renderedItems}</Box>;
}

function renderShortcutSelectItems<V>(
	items: readonly RenderedShortcutItem<V>[],
	selectedIndex: number,
	themeColor: string,
): ReactNode[] {
	const renderedItems = new Array<ReactNode>(items.length);
	let writeIndex = 0;
	for (let index = 0; index < items.length; index += 1) {
		const item = items[index];
		if (item === undefined) continue;
		const isSelected = index === selectedIndex;
		renderedItems[writeIndex] = (
			<Box key={index}>
				<IndicatorComponent isSelected={isSelected} />
				<UnderlineItem
					isSelected={isSelected}
					label={item.item.label}
					shortcut={item.shortcut}
					themeColor={themeColor}
				/>
			</Box>
		);
		writeIndex += 1;
	}
	if (writeIndex < renderedItems.length) renderedItems.length = writeIndex;
	return renderedItems;
}

function UnderlineItem({
	isSelected = false,
	label,
	shortcut,
	themeColor,
}: {
	isSelected: boolean;
	label: string;
	shortcut: string;
	themeColor: string;
}) {
	const color = isSelected ? themeColor : undefined;
	const renderedLabel = normalizeRenderedLineBreaks(label);
	const shortcutCode = shortcut.length === 1 ? shortcut.charCodeAt(0) : -1;
	const isNumeric = shortcutCode >= 48 && shortcutCode <= 57;

	if (isNumeric) {
		return (
			<>
				<Text color="gray">{shortcut}:</Text>
				<Text> </Text>
				<Text color={color}>{renderedLabel}</Text>
			</>
		);
	}

	return (
		<>
			<Text color={color}>{renderedLabel}</Text>
			<Text> </Text>
			<Text color="gray">({shortcut})</Text>
		</>
	);
}
