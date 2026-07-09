import { Box, type DOMElement, Text } from "ink";
import type { ReactNode, RefObject } from "react";
import { useMemo } from "react";
import { wrapTextWithMapping } from "../../shell/text-processing";
import { splitRenderedLines } from "../../render/lines";
import { nextTextBoundary } from "./boundaries";
import {
	computeImageBadgeLayout,
	EMPTY_IMAGE_BADGE_ROWS,
	getImageBadgeText,
	type ImageBadgeLayoutItem,
	LOADING_BADGE_TEXT,
} from "./badges";
import { renderCursorText } from "./cursor-render";

type TextInputRenderOptions = {
	attachedImageCount: number;
	showLoadingImageBadge: boolean;
	measuredWidth: number;
	mask: string | undefined;
	originalValue: string;
	renderCursorPosition: number;
	placeholder: string;
	showCursor: boolean;
	focus: boolean;
};

type TextInputRenderModel = {
	imageBadgeRows: ImageBadgeLayoutItem[][];
	lines: string[];
	textLineStartIndex: number;
	hasSharedRow: boolean;
};

export function buildTextInputRenderModel(
	options: TextInputRenderOptions,
): TextInputRenderModel {
	const masked = options.mask
		? maskedTextAndCursorPosition(
				options.originalValue,
				options.renderCursorPosition,
				options.mask,
			)
		: undefined;
	const value = masked?.value ?? options.originalValue;
	const valueCursorPosition =
		masked?.cursorPosition ?? options.renderCursorPosition;
	let imageBadgeRows = EMPTY_IMAGE_BADGE_ROWS;
	let remainingWidthForText = options.measuredWidth;
	if (options.attachedImageCount > 0 || options.showLoadingImageBadge) {
		const imageLayout = computeImageBadgeLayout(
			options.attachedImageCount,
			options.showLoadingImageBadge,
			options.measuredWidth,
		);
		imageBadgeRows = imageLayout.badgeRows;
		remainingWidthForText = imageLayout.remainingWidthForText;
	}
	const textStartsOnBadgeRow =
		imageBadgeRows.length > 0 && remainingWidthForText >= 5;
	const remainingWidthForFirstTextLine = textStartsOnBadgeRow
		? remainingWidthForText
		: undefined;
	const { wrapped, originalToWrapped } = wrapTextWithMapping(
		value,
		options.measuredWidth,
		remainingWidthForFirstTextLine,
	);
	const wrappedCursorPosition =
		originalToWrapped[valueCursorPosition] ?? valueCursorPosition;
	const rendered = renderCursorText({
		wrapped,
		wrappedCursorPosition,
		placeholder: options.placeholder,
		showCursor: options.showCursor,
		focus: options.focus,
		value,
	});
	const lines = splitRenderedTextLines(rendered);
	const hasSharedRow = textStartsOnBadgeRow && imageBadgeRows.length > 0;
	return {
		imageBadgeRows,
		lines,
		textLineStartIndex: hasSharedRow ? 1 : 0,
		hasSharedRow,
	};
}

export function maskedText(value: string, mask: string): string {
	let graphemeCount = 0;
	let cursor = 0;
	while (cursor < value.length) {
		const nextCursor = nextTextBoundary(value, cursor);
		if (nextCursor <= cursor) break;
		graphemeCount += 1;
		cursor = nextCursor;
	}
	return mask.repeat(graphemeCount);
}

function maskedTextAndCursorPosition(
	value: string,
	cursorPosition: number,
	mask: string,
): { value: string; cursorPosition: number } {
	let graphemeCount = 0;
	let cursorGraphemeCount = 0;
	let cursor = 0;
	while (cursor < value.length) {
		const nextCursor = nextTextBoundary(value, cursor);
		if (nextCursor <= cursor) break;
		if (nextCursor <= cursorPosition) cursorGraphemeCount += 1;
		graphemeCount += 1;
		cursor = nextCursor;
	}
	return {
		value: mask.repeat(graphemeCount),
		cursorPosition: cursorGraphemeCount * mask.length,
	};
}

export function splitRenderedTextLines(rendered: string): string[] {
	return splitRenderedLines(rendered);
}

export function TextInputRows({
	containerRef,
	renderModel,
}: {
	containerRef: RefObject<DOMElement | null>;
	renderModel: TextInputRenderModel;
}) {
	const rows = useMemo(
		() => renderTextInputRowNodes(renderModel),
		[renderModel],
	);
	return (
		<Box ref={containerRef} flexGrow={1} flexDirection="column">
			{rows}
		</Box>
	);
}

function renderTextInputRowNodes(
	renderModel: TextInputRenderModel,
): ReactNode[] {
	const badgeRows = renderModel.imageBadgeRows;
	const textLineCount = Math.max(
		renderModel.lines.length - renderModel.textLineStartIndex,
		0,
	);
	const rows = new Array<ReactNode>(badgeRows.length + textLineCount);
	const lastBadgeRowIndex = badgeRows.length - 1;
	for (let rowIndex = 0; rowIndex < badgeRows.length; rowIndex += 1) {
		rows[rowIndex] = (
			<ImageBadgeRow
				imageBadgeItems={badgeRows[rowIndex]}
				isSharedRow={renderModel.hasSharedRow && rowIndex === lastBadgeRowIndex}
				key={-(rowIndex + 1)}
				sharedText={renderModel.lines[0]}
			/>
		);
	}
	appendTextLineRows(
		rows,
		badgeRows.length,
		renderModel.lines,
		renderModel.textLineStartIndex,
	);
	return rows;
}

function appendTextLineRows(
	rows: ReactNode[],
	writeIndex: number,
	lines: string[],
	startIndex: number,
) {
	let rowIndex = writeIndex;
	for (let index = startIndex; index < lines.length; index += 1) {
		rows[rowIndex] = (
			<Box height={1} key={index - startIndex}>
				<Text>{lines[index]}</Text>
			</Box>
		);
		rowIndex += 1;
	}
}

function ImageBadgeRow({
	imageBadgeItems,
	isSharedRow,
	sharedText,
}: {
	imageBadgeItems: ImageBadgeLayoutItem[];
	isSharedRow: boolean;
	sharedText: string;
}) {
	return (
		<Box flexDirection="row" height={1}>
			{renderImageBadgeItems(imageBadgeItems)}
			{isSharedRow && <Text>{sharedText}</Text>}
		</Box>
	);
}

function renderImageBadgeItems(
	imageBadgeItems: readonly ImageBadgeLayoutItem[],
): ReactNode[] {
	const rows = new Array<ReactNode>(imageBadgeItems.length);
	let index = 0;
	let writeIndex = 0;
	while (index < imageBadgeItems.length) {
		const item = imageBadgeItems[index];
		index += 1;
		if (item === undefined) continue;
		rows[writeIndex] = (
			<Box key={item.index} marginRight={1}>
				<Text inverse={true}>
					{item.isLoading ? LOADING_BADGE_TEXT : getImageBadgeText(item.index)}
				</Text>
			</Box>
		);
		writeIndex += 1;
	}
	if (writeIndex < rows.length) rows.length = writeIndex;
	return rows;
}
