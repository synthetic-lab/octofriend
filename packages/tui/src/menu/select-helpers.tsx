import { Box } from "ink";
import React, { type FC } from "react";
import type {
	SelectIndicatorProps,
	SelectItem,
	SelectItemProps,
} from "./select";

function normalizedRotationStart(length: number, rotateIndex: number): number {
	if (length === 0) return 0;
	return (((length - rotateIndex) % length) + length) % length;
}

export function visibleItemAt<V>(
	items: readonly SelectItem<V>[],
	visibleIndex: number,
	hasLimit: boolean,
	limit: number,
	rotateIndex: number,
): SelectItem<V> | undefined {
	if (visibleIndex < 0) return undefined;
	if (!hasLimit) return items[visibleIndex];
	const visibleLength = Math.min(limit, items.length);
	if (visibleIndex >= visibleLength) return undefined;
	const start = normalizedRotationStart(items.length, rotateIndex);
	return items[(start + visibleIndex) % items.length];
}

function selectItemRenderKey<V>(
	item: SelectItem<V>,
	sourceIndex: number,
): string {
	if (item.key !== undefined) return item.key;
	const value = item.value;
	const valueType = typeof value;
	switch (valueType) {
		case "string":
		case "number":
		case "boolean":
		case "bigint":
		case "symbol":
			return `${valueType}:${String(value)}:${sourceIndex}`;
		default:
			return `index:${sourceIndex}`;
	}
}

export function numberInputIndex(input: string): number {
	if (input.length !== 1) return -1;
	const charCode = input.charCodeAt(0);
	return charCode >= 49 && charCode <= 57 ? charCode - 49 : -1;
}

function isUnboundedNoopMove(
	hasLimit: boolean,
	currentIndex: number,
	nextIndex: number,
): boolean {
	return !hasLimit && currentIndex === nextIndex;
}

type SelectMove = {
	rotateIndex: number;
	selectedIndex: number;
};

function selectMoveAtTop(
	itemCount: number,
	hasLimit: boolean,
	limit: number,
	currentRotateIndex: number,
): SelectMove | null {
	const lastVisibleIndex = (hasLimit ? limit : itemCount) - 1;
	const selectedIndex = hasLimit ? 0 : lastVisibleIndex;
	if (isUnboundedNoopMove(hasLimit, 0, selectedIndex)) return null;
	return {
		rotateIndex: hasLimit ? currentRotateIndex + 1 : 0,
		selectedIndex,
	};
}

function selectMoveAtBottom(
	hasLimit: boolean,
	currentRotateIndex: number,
	currentSelectedIndex: number,
): SelectMove | null {
	const selectedIndex = hasLimit ? currentSelectedIndex : 0;
	if (isUnboundedNoopMove(hasLimit, currentSelectedIndex, selectedIndex)) {
		return null;
	}
	return {
		rotateIndex: hasLimit ? currentRotateIndex - 1 : 0,
		selectedIndex,
	};
}

export function selectMove(
	direction: -1 | 1,
	itemCount: number,
	hasLimit: boolean,
	limit: number,
	currentRotateIndex: number,
	currentSelectedIndex: number,
): SelectMove | null {
	if (itemCount === 0 || limit === 0) return null;
	if (direction < 0 && currentSelectedIndex === 0) {
		return selectMoveAtTop(itemCount, hasLimit, limit, currentRotateIndex);
	}
	const lastVisibleIndex = (hasLimit ? limit : itemCount) - 1;
	if (direction > 0 && currentSelectedIndex === lastVisibleIndex) {
		return selectMoveAtBottom(
			hasLimit,
			currentRotateIndex,
			currentSelectedIndex,
		);
	}
	return {
		rotateIndex: currentRotateIndex,
		selectedIndex: currentSelectedIndex + direction,
	};
}

export function normalizedSelectLimit(
	customLimit: number | undefined,
): number | undefined {
	if (typeof customLimit !== "number" || !Number.isFinite(customLimit)) {
		return undefined;
	}
	return Math.max(0, Math.floor(customLimit));
}

export function initialSelectedIndex(
	initialIndex: number,
	lastIndex: number,
): number {
	if (lastIndex < 0 || initialIndex <= 0) return 0;
	return initialIndex > lastIndex ? lastIndex : initialIndex;
}

export function initialRotateIndex(
	initialIndex: number,
	lastIndex: number,
): number {
	if (lastIndex < 0 || initialIndex <= lastIndex) return 0;
	return lastIndex - initialIndex;
}

export function selectValuesEqual<V>(
	left: readonly SelectItem<V>[],
	right: readonly SelectItem<V>[],
): boolean {
	if (left === right) return true;
	if (left.length !== right.length) return false;
	for (let index = 0; index < left.length; index += 1) {
		const leftItem = left[index];
		const rightItem = right[index];
		if (leftItem === rightItem) continue;
		if (leftItem?.key !== undefined || rightItem?.key !== undefined) {
			if (leftItem?.key !== rightItem?.key) return false;
			continue;
		}
		if (!Object.is(leftItem?.value, rightItem?.value)) return false;
	}
	return true;
}

export function renderVisibleSelectItems<V>(
	items: readonly SelectItem<V>[],
	selectedIndex: number,
	hasLimit: boolean,
	limit: number,
	rotateIndex: number,
	indicatorComponent: FC<SelectIndicatorProps>,
	itemComponent: FC<SelectItemProps>,
): React.ReactNode[] {
	const length = items.length;
	if (!hasLimit) {
		const renderedItems = new Array<React.ReactNode>(length);
		let writeIndex = 0;
		for (let index = 0; index < length; index += 1) {
			const item = items[index];
			if (item === undefined) continue;
			const isSelected = index === selectedIndex;
			renderedItems[writeIndex] = (
				<Box key={selectItemRenderKey(item, index)}>
					{React.createElement(indicatorComponent, { isSelected })}
					{React.createElement(itemComponent, {
						isSelected,
						label: item.label,
					})}
				</Box>
			);
			writeIndex += 1;
		}
		if (writeIndex < renderedItems.length) renderedItems.length = writeIndex;
		return renderedItems;
	}

	const visibleLength = Math.min(limit, length);
	const renderedItems = new Array<React.ReactNode>(visibleLength);
	let writeIndex = 0;
	const start = normalizedRotationStart(length, rotateIndex);
	for (let index = 0; index < visibleLength; index += 1) {
		const sourceIndex = (start + index) % length;
		const item = items[sourceIndex];
		if (item === undefined) continue;
		const isSelected = index === selectedIndex;
		renderedItems[writeIndex] = (
			<Box key={selectItemRenderKey(item, sourceIndex)}>
				{React.createElement(indicatorComponent, { isSelected })}
				{React.createElement(itemComponent, {
					isSelected,
					label: item.label,
				})}
			</Box>
		);
		writeIndex += 1;
	}
	if (writeIndex < renderedItems.length) renderedItems.length = writeIndex;
	return renderedItems;
}
