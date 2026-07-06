import { isDeepStrictEqual } from "node:util";
import { Box, Text, useInput } from "ink";
import {
	type Dispatch,
	type ReactNode,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { ThemedSelectIndicator as IndicatorComponent } from "../menu/select.tsx";
import { Octo, useTerminalThemeColor } from "../theme/branding.tsx";

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

type KbSelectProps<V> = {
	shortcutItems: ShortcutArray<V>;
	onSelect: (item: Item<V>) => unknown;
};

type RenderedShortcutItem<V> = {
	item: Item<V | "next-page" | "prev-page">;
	shortcut: string;
	isNavItem?: boolean;
};

const PAGE_SIZE = 10;

function hasNavigationShortcut<V>(
	items: RenderedShortcutItem<V>[],
	shortcut: "h" | "l",
): boolean {
	return items.some((item) => item.shortcut === shortcut && item.isNavItem);
}

function findShortcutItem<V>(
	items: RenderedShortcutItem<V>[],
	input: string,
): RenderedShortcutItem<V> | undefined {
	return items.find(
		(item) => item.shortcut.toLowerCase() === input.toLowerCase(),
	);
}

function previousSelection(
	selectedIndex: number,
	rotateIndex: number,
	itemCount: number,
): { selectedIndex: number; rotateIndex: number } {
	const lastIndex = itemCount - 1;
	const atFirstIndex = selectedIndex === 0;
	return {
		selectedIndex: atFirstIndex ? lastIndex : selectedIndex - 1,
		rotateIndex: atFirstIndex ? rotateIndex + 1 : rotateIndex,
	};
}

function nextSelection(
	selectedIndex: number,
	rotateIndex: number,
	itemCount: number,
): { selectedIndex: number; rotateIndex: number } {
	const atLastIndex = selectedIndex === itemCount - 1;
	return {
		selectedIndex: atLastIndex ? 0 : selectedIndex + 1,
		rotateIndex: atLastIndex ? rotateIndex - 1 : rotateIndex,
	};
}

function handlePageShortcut<V>({
	input,
	items,
	page,
	setPage,
	setRotateIndex,
	setSelectedIndex,
}: {
	input: string;
	items: RenderedShortcutItem<V>[];
	page: number;
	setPage: Dispatch<SetStateAction<number>>;
	setRotateIndex: Dispatch<SetStateAction<number>>;
	setSelectedIndex: Dispatch<SetStateAction<number>>;
}): boolean {
	const direction = input === "l" ? 1 : input === "h" ? -1 : 0;
	if (direction === 0) return false;
	if (direction === -1 && page <= 0) return false;
	if (!hasNavigationShortcut(items, direction === 1 ? "l" : "h")) return false;

	setPage((prev) => prev + direction);
	setSelectedIndex(0);
	setRotateIndex(0);
	return true;
}

function handleDirectShortcut<V>({
	input,
	items,
	handleSelect,
}: {
	input: string;
	items: RenderedShortcutItem<V>[];
	handleSelect: (item: Item<V | "next-page" | "prev-page">) => void;
}): boolean {
	const shortcutItem = findShortcutItem(items, input);
	if (!shortcutItem) return false;

	handleSelect(shortcutItem.item);
	return true;
}

function handleSelectionMovement({
	input,
	isUpArrow,
	isDownArrow,
	itemsLength,
	rotateIndex,
	selectedIndex,
	setRotateIndex,
	setSelectedIndex,
}: {
	input: string;
	isUpArrow: boolean;
	isDownArrow: boolean;
	itemsLength: number;
	rotateIndex: number;
	selectedIndex: number;
	setRotateIndex: Dispatch<SetStateAction<number>>;
	setSelectedIndex: Dispatch<SetStateAction<number>>;
}): boolean {
	const next =
		input === "k" || isUpArrow
			? previousSelection(selectedIndex, rotateIndex, itemsLength)
			: input === "j" || isDownArrow
				? nextSelection(selectedIndex, rotateIndex, itemsLength)
				: undefined;
	if (!next) return false;

	setRotateIndex(next.rotateIndex);
	setSelectedIndex(next.selectedIndex);
	return true;
}

export function KbShortcutSelect<V>({
	shortcutItems,
	onSelect,
}: KbSelectProps<V>) {
	const [page, setPage] = useState(0);

	const items = useMemo(() => {
		const result: RenderedShortcutItem<V>[] = [];

		shortcutItems.forEach((shortcutType) => {
			if (shortcutType.type === "key") {
				Object.entries(shortcutType.mapping).forEach(([k, v]) => {
					if (k === "j" || k === "k" || k === "h" || k === "l") {
						return;
					}
					if (v) {
						result.push({
							item: v,
							shortcut: k,
						});
					}
				});
			} else {
				const totalItems = shortcutType.order.length;
				const totalPages = Math.ceil(totalItems / PAGE_SIZE);
				const hasPrev = page > 0;
				const hasNext = page < totalPages - 1;

				const start = page * PAGE_SIZE;
				const end = Math.min(start + PAGE_SIZE, totalItems);
				const pageItems = shortcutType.order.slice(start, end);

				pageItems.forEach((item, index) => {
					result.push({
						item,
						shortcut: `${index}`,
					});
				});

				if (hasPrev) {
					result.push({
						item: { label: "Previous page", value: "prev-page" },
						shortcut: "h",
						isNavItem: true,
					});
				}
				if (hasNext) {
					result.push({
						item: { label: "Next page", value: "next-page" },
						shortcut: "l",
						isNavItem: true,
					});
				}
			}
		});

		return result;
	}, [shortcutItems, page]);

	const initialIndex = 0;
	const lastIndex = items.length - 1;
	const [rotateIndex, setRotateIndex] = useState(
		initialIndex > lastIndex ? lastIndex - initialIndex : 0,
	);
	const [selectedIndex, setSelectedIndex] = useState(
		initialIndex ? (initialIndex > lastIndex ? lastIndex : initialIndex) : 0,
	);
	const previousShortcutItems = useRef(shortcutItems);

	useEffect(() => {
		if (!isDeepStrictEqual(previousShortcutItems.current, shortcutItems)) {
			setRotateIndex(0);
			setSelectedIndex(0);
			setPage(0);
		}

		previousShortcutItems.current = shortcutItems;
	}, [shortcutItems]);

	const handleSelect = useCallback(
		(item: Item<V | "next-page" | "prev-page">) => {
			if (item.value === "next-page" || item.value === "prev-page") {
				return;
			}
			onSelect(item as Item<V>);
		},
		[onSelect],
	);

	useInput((input, key) => {
		if (key.ctrl) return;

		if (
			handlePageShortcut({
				input,
				items,
				page,
				setPage,
				setRotateIndex,
				setSelectedIndex,
			})
		) {
			return;
		}

		if (handleDirectShortcut({ input, items, handleSelect })) return;

		if (
			handleSelectionMovement({
				input,
				isUpArrow: key.upArrow,
				isDownArrow: key.downArrow,
				itemsLength: items.length,
				rotateIndex,
				selectedIndex,
				setRotateIndex,
				setSelectedIndex,
			})
		) {
			return;
		}

		if (key.return && items[selectedIndex]) {
			handleSelect(items[selectedIndex].item);
		}
	});

	return (
		<Box flexDirection="column">
			{items.map((item, index) => {
				const isSelected = index === selectedIndex;

				return (
					<Box key={`kb-select-${index}`}>
						<IndicatorComponent isSelected={isSelected} />
						<UnderlineItem
							isSelected={isSelected}
							label={item.item.label}
							shortcut={item.shortcut}
						/>
					</Box>
				);
			})}
		</Box>
	);
}

function UnderlineItem({
	isSelected = false,
	label,
	shortcut,
}: {
	isSelected: boolean;
	label: string;
	shortcut: string;
}) {
	const themeColor = useTerminalThemeColor();
	const color = isSelected ? themeColor : undefined;
	const isNumeric = !Number.isNaN(Number.parseInt(shortcut, 10));

	if (isNumeric) {
		return (
			<>
				<Text color="gray">{shortcut}:</Text>
				<Text> </Text>
				<Text color={color}>{label}</Text>
			</>
		);
	}

	return (
		<>
			<Text color={color}>{label}</Text>
			<Text> </Text>
			<Text color="gray">({shortcut})</Text>
		</>
	);
}

type KbPanelProps<V> = {
	shortcutItems: ShortcutArray<V>;
	onSelect: (item: Item<V>) => unknown;
	title: string;
	children?: ReactNode;
};

function ShortcutMenuHeader({ title }: { title: string }) {
	return (
		<Box justifyContent="center" marginBottom={1}>
			<Box justifyContent="center" width={80}>
				<Octo />
				<Box marginLeft={1}>
					<Text>{title}</Text>
				</Box>
			</Box>
		</Box>
	);
}

export function KbShortcutPanel<V>({
	shortcutItems,
	onSelect,
	title,
	children,
}: KbPanelProps<V>) {
	return (
		<Box flexDirection="column">
			<ShortcutMenuHeader title={title} />
			{children && (
				<Box justifyContent="center" alignItems="center" marginBottom={1}>
					<Box flexDirection="column" width={80}>
						{children}
					</Box>
				</Box>
			)}
			<Box justifyContent="center">
				<KbShortcutSelect shortcutItems={shortcutItems} onSelect={onSelect} />
			</Box>
		</Box>
	);
}

type ConfirmDialogProps = {
	confirmLabel: string;
	rejectLabel: string;
	onConfirm: () => unknown;
	onReject: () => unknown;
	rejectFirst?: boolean;
};

export function ConfirmDialog({
	confirmLabel,
	rejectLabel,
	onConfirm,
	onReject,
	rejectFirst = false,
}: ConfirmDialogProps) {
	const items = [
		{
			type: "key" as const,
			mapping: rejectFirst
				? {
						n: {
							label: rejectLabel,
							value: "reject" as const,
						},
						y: {
							label: confirmLabel,
							value: "confirm" as const,
						},
					}
				: {
						y: {
							label: confirmLabel,
							value: "confirm" as const,
						},
						n: {
							label: rejectLabel,
							value: "reject" as const,
						},
					},
		},
	] satisfies ShortcutArray<"confirm" | "reject">;

	const onSelect = useCallback((item: Item<"confirm" | "reject">) => {
		if (item.value === "confirm") return onConfirm();
		return onReject();
	}, []);

	return (
		<Box justifyContent="center">
			<KbShortcutSelect shortcutItems={items} onSelect={onSelect} />
		</Box>
	);
}
