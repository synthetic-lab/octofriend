import figures from "figures";
import { Box, Text } from "ink";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type InkInputKey,
	useLatestInput,
	useLatestRef,
} from "../input/latest_input.ts";
import { normalizeRenderedLineBreaks } from "../rendering/line_splitting.ts";
import { useTerminalThemeColor } from "../theme/branding.tsx";
import {
	initialRotateIndex,
	initialSelectedIndex,
	normalizedSelectLimit,
	numberInputIndex,
	renderVisibleSelectItems,
	selectMove,
	selectValuesEqual,
	visibleItemAt,
} from "./select_helpers.tsx";

export type SelectIndicatorProps = {
	readonly isSelected?: boolean;
};

export type SelectItemProps = {
	readonly isSelected?: boolean;
	readonly label: string;
};

export type SelectItem<V> = {
	key?: string;
	label: string;
	value: V;
};

export type SelectInputProps<V> = {
	readonly items?: SelectItem<V>[];
	readonly isFocused?: boolean;
	readonly initialIndex?: number;
	readonly limit?: number;
	readonly indicatorComponent?: FC<SelectIndicatorProps>;
	readonly itemComponent?: FC<SelectItemProps>;
	readonly onSelect?: (item: SelectItem<V>) => void;
	readonly onHighlight?: (item: SelectItem<V>) => void;
};

export function DefaultSelectIndicator({
	isSelected = false,
}: SelectIndicatorProps) {
	return (
		<Box marginRight={1}>
			{isSelected ? (
				<Text color="blue">{figures.pointer}</Text>
			) : (
				<Text> </Text>
			)}
		</Box>
	);
}

export function DefaultSelectItem({
	isSelected = false,
	label,
}: SelectItemProps) {
	return (
		<Text color={isSelected ? "blue" : undefined}>
			{normalizeRenderedLineBreaks(label)}
		</Text>
	);
}

export function ThemedSelectIndicator({
	isSelected = false,
}: SelectIndicatorProps) {
	const themeColor = useTerminalThemeColor();
	return (
		<Box marginRight={1}>
			{isSelected ? (
				<Text color={themeColor}>{figures.pointer}</Text>
			) : (
				<Text> </Text>
			)}
		</Box>
	);
}

export function ThemedSelectItem({
	isSelected = false,
	label,
}: SelectItemProps) {
	const themeColor = useTerminalThemeColor();
	return (
		<Text color={isSelected ? themeColor : undefined}>
			{normalizeRenderedLineBreaks(label)}
		</Text>
	);
}

export function SelectInput<V>({
	items = [],
	isFocused = true,
	initialIndex = 0,
	indicatorComponent = DefaultSelectIndicator,
	itemComponent = DefaultSelectItem,
	limit: customLimit,
	onSelect,
	onHighlight,
}: SelectInputProps<V>) {
	const normalizedLimit = normalizedSelectLimit(customLimit);
	const hasLimit =
		normalizedLimit !== undefined && items.length > normalizedLimit;
	const limit = hasLimit ? normalizedLimit : items.length;
	const lastIndex = limit - 1;
	const [rotateIndex, setRotateIndex] = useState(
		initialRotateIndex(initialIndex, lastIndex),
	);
	const [selectedIndex, setSelectedIndex] = useState(
		initialSelectedIndex(initialIndex, lastIndex),
	);
	const onHighlightRef = useLatestRef(onHighlight);
	const onSelectRef = useLatestRef(onSelect);
	const previousItems = useRef<SelectItem<V>[]>(items);
	const itemsChanged = !selectValuesEqual(previousItems.current, items);
	const renderedRotateIndex = itemsChanged ? 0 : rotateIndex;
	const renderedSelectedIndex = itemsChanged ? 0 : selectedIndex;

	useEffect(() => {
		if (!itemsChanged) return;
		previousItems.current = items;
		if (rotateIndex !== 0) setRotateIndex(0);
		if (selectedIndex !== 0) setSelectedIndex(0);
	}, [items, itemsChanged, rotateIndex, selectedIndex]);

	const highlightAt = useCallback(
		(nextRotateIndex: number, nextSelectedIndex: number) => {
			const item = visibleItemAt(
				items,
				nextSelectedIndex,
				hasLimit,
				limit,
				nextRotateIndex,
			);
			const onHighlightValue = onHighlightRef.current;
			if (item && typeof onHighlightValue === "function") {
				onHighlightValue(item);
			}
		},
		[hasLimit, items, limit, onHighlightRef],
	);

	const selectAt = useCallback(
		(nextRotateIndex: number, nextSelectedIndex: number) => {
			const item = visibleItemAt(
				items,
				nextSelectedIndex,
				hasLimit,
				limit,
				nextRotateIndex,
			);
			const onSelectValue = onSelectRef.current;
			if (item && typeof onSelectValue === "function") {
				onSelectValue(item);
			}
		},
		[hasLimit, items, limit, onSelectRef],
	);

	const applyMove = useCallback(
		(nextRotateIndex: number, nextSelectedIndex: number) => {
			setRotateIndex(nextRotateIndex);
			setSelectedIndex(nextSelectedIndex);
			highlightAt(nextRotateIndex, nextSelectedIndex);
		},
		[highlightAt],
	);

	const moveSelection = useCallback(
		(direction: -1 | 1) => {
			const move = selectMove(
				direction,
				items.length,
				hasLimit,
				limit,
				renderedRotateIndex,
				renderedSelectedIndex,
			);
			if (move === null) return;
			applyMove(move.rotateIndex, move.selectedIndex);
		},
		[
			applyMove,
			hasLimit,
			items.length,
			limit,
			renderedRotateIndex,
			renderedSelectedIndex,
		],
	);

	const handleInput = useCallback(
		(input: string, key: InkInputKey) => {
			if (input === "k" || key.upArrow) {
				moveSelection(-1);
				return;
			}

			if (input === "j" || key.downArrow) {
				moveSelection(1);
				return;
			}

			const numberedIndex = numberInputIndex(input);
			if (numberedIndex !== -1) {
				selectAt(renderedRotateIndex, numberedIndex);
				return;
			}

			if (key.return) {
				selectAt(renderedRotateIndex, renderedSelectedIndex);
			}
		},
		[moveSelection, renderedRotateIndex, renderedSelectedIndex, selectAt],
	);

	const inputOptions = useMemo(() => ({ isActive: isFocused }), [isFocused]);
	const visibleItems = useMemo(
		() =>
			renderVisibleSelectItems(
				items,
				renderedSelectedIndex,
				hasLimit,
				limit,
				renderedRotateIndex,
				indicatorComponent,
				itemComponent,
			),
		[
			hasLimit,
			indicatorComponent,
			itemComponent,
			items,
			limit,
			renderedRotateIndex,
			renderedSelectedIndex,
		],
	);

	useLatestInput(handleInput, inputOptions);

	return <Box flexDirection="column">{visibleItems}</Box>;
}
