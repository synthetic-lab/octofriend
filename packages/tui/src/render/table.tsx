import { Box, Text } from "ink";
import type { Tokens } from "marked";
import React from "react";
import stringWidth from "string-width";
import { renderTokensAsPlaintext } from "./plaintext.ts";

type RenderedTableCell = {
	text: string;
};

type RenderedTableModel = {
	headerCells: RenderedTableCell[];
	renderedRows: RenderedTableCell[][];
	columnWidths: number[];
	separator: string;
};

export function TableRenderer({ token }: { token: Tokens.Table }) {
	const model = React.useMemo(() => buildTableModel(token), [token]);
	return (
		<Box flexDirection="column" marginTop={1} marginBottom={1}>
			<TableRowRenderer
				cells={model.headerCells}
				columnWidths={model.columnWidths}
				isHeader={true}
			/>
			<Text color="gray">{model.separator}</Text>
			{renderTableRows(model.renderedRows, model.columnWidths)}
		</Box>
	);
}

function buildTableModel(token: Tokens.Table): RenderedTableModel {
	const columnCount = token.header.length;
	const columnWidths = new Array<number>(columnCount);
	const headerCells = renderPlainTableCells(
		token.header,
		columnWidths,
		columnCount,
		3,
	);

	const rows = token.rows;
	const renderedRows = new Array<RenderedTableCell[]>(rows.length);
	let renderedRowCount = 0;
	for (const row of rows) {
		if (row === undefined) continue;
		renderedRows[renderedRowCount] = renderPlainTableCells(
			row,
			columnWidths,
			columnCount,
		);
		renderedRowCount += 1;
	}

	if (renderedRowCount < renderedRows.length)
		renderedRows.length = renderedRowCount;

	return {
		headerCells,
		renderedRows,
		columnWidths,
		separator: tableSeparator(columnWidths),
	};
}

function tableSeparator(columnWidths: readonly number[]): string {
	const parts = new Array<string>(columnWidths.length * 2 + 2);
	let writeIndex = 0;
	parts[writeIndex] = "├";
	writeIndex += 1;
	for (let index = 0; index < columnWidths.length; index += 1) {
		if (index > 0) {
			parts[writeIndex] = "┼";
			writeIndex += 1;
		}
		parts[writeIndex] = "─".repeat((columnWidths[index] ?? 0) + 2);
		writeIndex += 1;
	}
	parts[writeIndex] = "┤";
	return parts.join("");
}

function renderTableRows(
	rows: readonly RenderedTableCell[][],
	columnWidths: readonly number[],
): React.ReactNode[] {
	const renderedRows = new Array<React.ReactNode>(rows.length);
	let writeIndex = 0;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index];
		if (row === undefined) continue;
		renderedRows[writeIndex] = (
			<TableRowRenderer
				key={index}
				cells={row}
				columnWidths={columnWidths}
				isHeader={false}
			/>
		);
		writeIndex += 1;
	}
	if (writeIndex < renderedRows.length) renderedRows.length = writeIndex;
	return renderedRows;
}

function renderPlainTableCells(
	cells: readonly Tokens.TableCell[],
	columnWidths: number[],
	columnCount: number,
	minimumColumnWidth = 0,
): RenderedTableCell[] {
	const renderedCells = new Array<RenderedTableCell>(columnCount);
	for (let index = 0; index < columnCount; index += 1) {
		const cell = cells[index];
		if (cell === undefined) {
			renderedCells[index] = { text: "" };
			continue;
		}
		const text = flattenTableCellText(renderTokensAsPlaintext(cell.tokens));
		const displayWidth = tableCellDisplayWidth(text);
		renderedCells[index] = { text };
		const columnWidth =
			displayWidth < minimumColumnWidth ? minimumColumnWidth : displayWidth;
		if (columnWidth > (columnWidths[index] ?? 0)) {
			columnWidths[index] = columnWidth;
		}
	}
	return renderedCells;
}

function flattenTableCellText(text: string): string {
	let firstBreak = -1;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 9 && code !== 10 && code !== 13) continue;
		firstBreak = index;
		break;
	}
	if (firstBreak === -1) return text;

	const parts: string[] = [];
	let writeStart = 0;
	let lastWasSpace = false;
	for (let index = firstBreak; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 9 && code !== 10 && code !== 13) continue;
		if (writeStart < index) {
			parts[parts.length] = text.slice(writeStart, index);
		}
		if (!lastWasSpace) {
			parts[parts.length] = " ";
			lastWasSpace = true;
		}
		writeStart = index + 1;
	}
	if (writeStart < text.length) parts[parts.length] = text.slice(writeStart);
	return parts.join("");
}

function tableCellDisplayWidth(text: string): number {
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code < 32 || code > 126) return stringWidth(text);
	}
	return text.length;
}

function TableRowRenderer({
	cells,
	columnWidths,
	isHeader,
}: {
	cells: RenderedTableCell[];
	columnWidths: readonly number[];
	isHeader: boolean;
}) {
	return (
		<Box flexDirection="row">
			<Text color="gray">│ </Text>
			{renderTableCells(cells, columnWidths, isHeader)}
		</Box>
	);
}

function renderTableCells(
	cells: readonly RenderedTableCell[],
	columnWidths: readonly number[],
	isHeader: boolean,
): React.ReactNode[] {
	const renderedCells = new Array<React.ReactNode>(cells.length);
	let writeIndex = 0;
	for (let index = 0; index < cells.length; index += 1) {
		const cell = cells[index];
		const columnWidth = columnWidths[index];
		if (cell === undefined || columnWidth === undefined) continue;
		renderedCells[writeIndex] = (
			<React.Fragment key={index}>
				<Box width={columnWidth}>
					<Text color={isHeader ? "cyan" : "white"} bold={isHeader}>
						{cell.text}
					</Text>
				</Box>
				<Text color="gray"> │ </Text>
			</React.Fragment>
		);
		writeIndex += 1;
	}
	if (writeIndex < renderedCells.length) renderedCells.length = writeIndex;
	return renderedCells;
}
