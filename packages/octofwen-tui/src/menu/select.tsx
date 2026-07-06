import { isDeepStrictEqual } from "node:util";
import figures from "figures";
import { Box, Text, useInput } from "ink";
import React, {
	type FC,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import arrayToRotated from "to-rotated";
import { useTerminalThemeColor } from "../theme/branding.tsx";

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
	return <Text color={isSelected ? "blue" : undefined}>{label}</Text>;
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
	return <Text color={isSelected ? themeColor : undefined}>{label}</Text>;
}

const NUMBER_INPUT_REGEX = /^[1-9]$/;

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
	const hasLimit =
		typeof customLimit === "number" && items.length > customLimit;
	const limit = hasLimit ? Math.min(customLimit, items.length) : items.length;
	const lastIndex = limit - 1;
	const [rotateIndex, setRotateIndex] = useState(
		initialIndex > lastIndex ? lastIndex - initialIndex : 0,
	);
	const [selectedIndex, setSelectedIndex] = useState(
		initialIndex ? (initialIndex > lastIndex ? lastIndex : initialIndex) : 0,
	);
	const previousItems = useRef<SelectItem<V>[]>(items);

	useEffect(() => {
		if (
			!isDeepStrictEqual(
				previousItems.current.map((item) => item.value),
				items.map((item) => item.value),
			)
		) {
			setRotateIndex(0);
			setSelectedIndex(0);
		}

		previousItems.current = items;
	}, [items]);

	const visibleItems = useCallback(
		(nextRotateIndex: number) =>
			hasLimit ? arrayToRotated(items, nextRotateIndex).slice(0, limit) : items,
		[hasLimit, items, limit],
	);

	const highlightAt = useCallback(
		(slicedItems: SelectItem<V>[], nextSelectedIndex: number) => {
			const item = slicedItems[nextSelectedIndex];
			if (item && typeof onHighlight === "function") {
				onHighlight(item);
			}
		},
		[onHighlight],
	);

	const selectAt = useCallback(
		(slicedItems: SelectItem<V>[], nextSelectedIndex: number) => {
			const item = slicedItems[nextSelectedIndex];
			if (item && typeof onSelect === "function") {
				onSelect(item);
			}
		},
		[onSelect],
	);

	const applyMove = useCallback(
		(nextRotateIndex: number, nextSelectedIndex: number) => {
			setRotateIndex(nextRotateIndex);
			setSelectedIndex(nextSelectedIndex);
			highlightAt(visibleItems(nextRotateIndex), nextSelectedIndex);
		},
		[highlightAt, visibleItems],
	);

	const moveUp = useCallback(() => {
		const lastVisibleIndex = (hasLimit ? limit : items.length) - 1;
		if (selectedIndex === 0) {
			applyMove(rotateIndex + 1, hasLimit ? selectedIndex : lastVisibleIndex);
			return;
		}

		applyMove(rotateIndex, selectedIndex - 1);
	}, [applyMove, hasLimit, items.length, limit, rotateIndex, selectedIndex]);

	const moveDown = useCallback(() => {
		const lastVisibleIndex = (hasLimit ? limit : items.length) - 1;
		if (selectedIndex === lastVisibleIndex) {
			applyMove(rotateIndex - 1, hasLimit ? selectedIndex : 0);
			return;
		}

		applyMove(rotateIndex, selectedIndex + 1);
	}, [applyMove, hasLimit, items.length, limit, rotateIndex, selectedIndex]);

	useInput(
		useCallback(
			(input, key) => {
				if (input === "k" || key.upArrow) {
					moveUp();
					return;
				}

				if (input === "j" || key.downArrow) {
					moveDown();
					return;
				}

				if (NUMBER_INPUT_REGEX.test(input)) {
					selectAt(visibleItems(rotateIndex), Number.parseInt(input, 10) - 1);
					return;
				}

				if (key.return) {
					selectAt(visibleItems(rotateIndex), selectedIndex);
				}
			},
			[moveDown, moveUp, rotateIndex, selectAt, selectedIndex, visibleItems],
		),
		{ isActive: isFocused },
	);

	const slicedItems: SelectItem<V>[] = hasLimit
		? arrayToRotated(items, rotateIndex).slice(0, limit)
		: items;

	return (
		<Box flexDirection="column">
			{slicedItems.map((item, index) => {
				const isSelected = index === selectedIndex;

				return (
					<Box key={item.key ?? String(item.value)}>
						{React.createElement(indicatorComponent, { isSelected })}
						{React.createElement(itemComponent, { ...item, isSelected })}
					</Box>
				);
			})}
		</Box>
	);
}
