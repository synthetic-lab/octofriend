import type { diffLines } from "diff";
import { Box, Text } from "ink";
import type React from "react";
import { DiffSet, DiffSide, type LineCounter } from "./code-line-segments.tsx";

export type DiffPart =
	| ReturnType<typeof diffLines>[number]
	| {
			added: false;
			removed: false;
			changed: true;
			oldValue: string;
			newValue: string;
	  };

type DiffPartsProps = {
	diffParts: DiffPart[];
	language: string;
	lineNrWidth: number;
	oldLineCounter: LineCounter;
	newLineCounter: LineCounter;
	oldLines: string[];
	newLines: string[];
};

export function SideBySideDiff(props: DiffPartsProps) {
	return (
		<>
			<Box>
				<Box width="50%" paddingX={1}>
					<Text color="gray">Old</Text>
				</Box>
				<Box width="50%" paddingX={1}>
					<Text color="gray">New</Text>
				</Box>
			</Box>
			{renderSideBySideDiffSets(props)}
		</>
	);
}

function renderSideBySideDiffSets({
	diffParts,
	language,
	lineNrWidth,
	oldLineCounter,
	newLineCounter,
	oldLines,
	newLines,
}: DiffPartsProps): React.ReactNode[] {
	const rows = new Array<React.ReactNode>(diffParts.length);
	let writeIndex = 0;
	for (let index = 0; index < diffParts.length; index += 1) {
		const part = diffParts[index];
		if (part === undefined) continue;
		let oldValue: string | undefined;
		let newValue: string | undefined;
		let oldRemoved: boolean | undefined;
		let newAdded: boolean | undefined;
		if (part.added) {
			newValue = part.value;
			newAdded = true;
		} else if (part.removed) {
			oldValue = part.value;
			oldRemoved = true;
		} else if ("changed" in part) {
			oldValue = part.oldValue;
			newValue = part.newValue;
			oldRemoved = true;
			newAdded = true;
		} else {
			oldValue = part.value;
			newValue = part.value;
		}
		rows[writeIndex] = (
			<DiffSet
				key={index}
				oldValue={oldValue}
				newValue={newValue}
				oldRemoved={oldRemoved}
				newAdded={newAdded}
				language={language}
				oldLines={oldLines}
				newLines={newLines}
				oldLineCounter={oldLineCounter}
				newLineCounter={newLineCounter}
				lineNrWidth={lineNrWidth}
			/>
		);
		writeIndex += 1;
	}
	if (writeIndex < rows.length) rows.length = writeIndex;
	return rows;
}

export function StackedDiff({
	diffParts,
	language,
	lineNrWidth,
	oldLineCounter,
	newLineCounter,
	oldLines,
	newLines,
}: DiffPartsProps) {
	return (
		<>
			<Box paddingX={1}>
				<Text color="gray">Old</Text>
			</Box>
			{renderOldDiffSideRows({
				diffParts,
				language,
				lineCounter: oldLineCounter,
				lineNrWidth,
				originalLines: oldLines,
			})}
			<Box paddingX={1} marginTop={1}>
				<Text color="gray">New</Text>
			</Box>
			{renderNewDiffSideRows({
				diffParts,
				language,
				lineCounter: newLineCounter,
				lineNrWidth,
				originalLines: newLines,
			})}
		</>
	);
}

type DiffSideRenderArgs = {
	diffParts: DiffPart[];
	language: string;
	lineCounter: LineCounter;
	lineNrWidth: number;
	originalLines: string[];
};

function renderOldDiffSideRows(args: DiffSideRenderArgs): React.ReactNode[] {
	return renderDiffSideRows(args, "old");
}

function renderNewDiffSideRows(args: DiffSideRenderArgs): React.ReactNode[] {
	return renderDiffSideRows(args, "new");
}

function shouldRenderDiffSidePart(
	part: DiffPart,
	side: "old" | "new",
): boolean {
	return side === "old" ? !part.added : !part.removed;
}

function diffSideValue(part: DiffPart, side: "old" | "new"): string {
	if (!("changed" in part)) return part.value;
	return side === "old" ? part.oldValue : part.newValue;
}

function renderDiffSideRow(
	part: DiffPart,
	index: number,
	args: Omit<DiffSideRenderArgs, "diffParts">,
	side: "old" | "new",
): React.ReactNode {
	const isChanged = part.removed || part.added || "changed" in part;
	const value = diffSideValue(part, side);
	if (side === "old") {
		return (
			<DiffSide
				key={index}
				side="old"
				oldValue={value}
				oldRemoved={isChanged}
				language={args.language}
				lineCounter={args.lineCounter}
				lineNrWidth={args.lineNrWidth}
				originalLines={args.originalLines}
			/>
		);
	}
	return (
		<DiffSide
			key={index}
			side="new"
			newValue={value}
			newAdded={isChanged}
			language={args.language}
			lineCounter={args.lineCounter}
			lineNrWidth={args.lineNrWidth}
			originalLines={args.originalLines}
		/>
	);
}

function renderDiffSideRows(
	{
		diffParts,
		language,
		lineCounter,
		lineNrWidth,
		originalLines,
	}: DiffSideRenderArgs,
	side: "old" | "new",
): React.ReactNode[] {
	const rows = new Array<React.ReactNode>(diffParts.length);
	const rowArgs = { language, lineCounter, lineNrWidth, originalLines };
	let writeIndex = 0;
	for (let index = 0; index < diffParts.length; index += 1) {
		const part = diffParts[index];
		if (part === undefined || !shouldRenderDiffSidePart(part, side)) continue;
		rows[writeIndex] = renderDiffSideRow(part, index, rowArgs, side);
		writeIndex += 1;
	}
	if (writeIndex < rows.length) rows.length = writeIndex;
	return rows;
}
