import { Box, Text } from "ink";
import type React from "react";
import { extractTrim } from "../shell/text-processing";
import { HighlightedCode } from "./highlight";
import { countRenderedLinesDropTrailingEmpty } from "./lines";

const CODE_GUTTER_COLOR = "gray";
const DIFF_REMOVED = "#880808";
const DIFF_ADDED = "#405e35";

export type LineCounter = {
	getLine: () => number;
	incrementLine: () => number;
	advanceLines: (count: number) => void;
	getStartLine: () => number;
};

export function buildLineCounter(startLine: number): LineCounter {
	let curr = startLine;
	return {
		getLine: () => curr,
		incrementLine: () => curr++,
		advanceLines: (count) => {
			curr += count;
		},
		getStartLine: () => startLine,
	};
}

export function DiffSide({
	side,
	oldValue,
	newValue,
	oldRemoved,
	newAdded,
	language,
	lineCounter,
	lineNrWidth,
	originalLines,
}: {
	side: "old" | "new";
	oldValue?: string;
	newValue?: string;
	oldRemoved?: boolean;
	newAdded?: boolean;
	language: string;
	lineCounter: LineCounter;
	lineNrWidth: number;
	originalLines: string[];
}) {
	const value = side === "old" ? oldValue : newValue;
	if (value == null) return null;

	const changed = side === "old" ? oldRemoved : newAdded;
	return (
		<LineSegments
			value={value}
			language={language}
			gutterWidth={3 + lineNrWidth}
			gutterColor={
				changed
					? side === "old"
						? DIFF_REMOVED
						: DIFF_ADDED
					: CODE_GUTTER_COLOR
			}
			lineCounter={lineCounter}
			originalLines={originalLines}
			paneWidth="100%"
		>
			{changed ? (
				<Text color="black">{side === "old" ? " - " : " + "}</Text>
			) : (
				<Text>{"  "}</Text>
			)}
		</LineSegments>
	);
}

export function DiffSet({
	oldValue,
	newValue,
	newAdded,
	oldRemoved,
	language,
	oldLineCounter,
	newLineCounter,
	lineNrWidth,
	oldLines,
	newLines,
}: {
	oldValue?: string;
	newValue?: string;
	oldRemoved?: boolean;
	newAdded?: boolean;
	oldLineCounter: LineCounter;
	newLineCounter: LineCounter;
	lineNrWidth: number;
	language: string;
	oldLines: string[];
	newLines: string[];
}) {
	const gutterWidth = 3 + lineNrWidth;
	return (
		<Box flexDirection="row">
			<LineSegments
				value={oldValue}
				language={language}
				gutterWidth={gutterWidth}
				gutterColor={oldRemoved ? DIFF_REMOVED : CODE_GUTTER_COLOR}
				lineCounter={oldLineCounter}
				originalLines={oldLines}
			>
				{oldRemoved ? <Text color="black"> - </Text> : <Text>{"  "}</Text>}
			</LineSegments>
			<LineSegments
				value={newValue}
				language={language}
				gutterWidth={gutterWidth}
				gutterColor={newAdded ? DIFF_ADDED : CODE_GUTTER_COLOR}
				lineCounter={newLineCounter}
				originalLines={newLines}
			>
				{newAdded ? <Text color="black"> + </Text> : <Text>{"  "}</Text>}
			</LineSegments>
		</Box>
	);
}

export function LineSegments({
	value,
	language,
	gutterColor,
	gutterWidth,
	lineCounter,
	children,
	originalLines,
	paneWidth = "50%",
}: {
	value: string | undefined;
	language: string;
	gutterColor: string;
	gutterWidth: number;
	lineCounter: LineCounter;
	children: React.ReactNode;
	originalLines: string[];
	paneWidth?: string;
}) {
	const valueLineCount = countRenderedLinesDropTrailingEmpty(value);
	if (valueLineCount === 0) {
		return (
			<Box width={paneWidth} paddingX={1} flexGrow={1}>
				<Box
					width={gutterWidth}
					flexShrink={0}
					flexGrow={1}
					backgroundColor={gutterColor}
					marginRight={1}
					height={1}
				/>
				<Box flexGrow={1} width="100%" flexDirection="column">
					<EmptyCodeLine />
				</Box>
			</Box>
		);
	}

	const startLine = lineCounter.getStartLine();

	return (
		<Box width={paneWidth} paddingX={1} flexDirection="column" flexGrow={1}>
			{renderLineSegmentRows({
				valueLineCount,
				language,
				gutterColor,
				gutterWidth,
				lineCounter,
				children,
				originalLines,
				startLine,
			})}
		</Box>
	);
}

function renderLineSegmentRows({
	valueLineCount,
	language,
	gutterColor,
	gutterWidth,
	lineCounter,
	children,
	originalLines,
	startLine,
}: {
	valueLineCount: number;
	language: string;
	gutterColor: string;
	gutterWidth: number;
	lineCounter: LineCounter;
	children: React.ReactNode;
	originalLines: string[];
	startLine: number;
}): React.ReactNode[] {
	const rows = new Array<React.ReactNode>(valueLineCount);
	for (let index = 0; index < valueLineCount; index += 1) {
		const lineNumber = lineCounter.incrementLine();
		rows[index] = (
			<Box key={index} flexGrow={1}>
				<Box
					width={gutterWidth}
					flexShrink={0}
					flexGrow={1}
					backgroundColor={gutterColor}
					marginRight={1}
				>
					<Text>{lineNumber}</Text>
					{children}
				</Box>
				<Box flexGrow={1} width="100%" flexDirection="column">
					<MaybeHighlighted
						language={language}
						originalLines={originalLines}
						currentLine={lineNumber}
						startLine={startLine}
					/>
				</Box>
			</Box>
		);
	}
	return rows;
}

export type RenderableCodeLineParts =
	| { kind: "plain"; text: string }
	| { kind: "highlighted"; leading: string; code: string; trailing: string };

export function renderableCodeLineParts(
	originalLine: string,
	language: string,
): RenderableCodeLineParts {
	if (language === "txt") return { kind: "plain", text: originalLine || " " };

	const matchedLine = extractTrim(originalLine);
	if (matchedLine[1] === "") {
		return { kind: "plain", text: matchedLine[0] || " " };
	}

	return {
		kind: "highlighted",
		leading: matchedLine[0],
		code: matchedLine[1],
		trailing: matchedLine[2],
	};
}

function MaybeHighlighted({
	language,
	originalLines,
	currentLine,
	startLine,
}: {
	language: string;
	originalLines: string[];
	currentLine: number;
	startLine: number;
}) {
	const relativeLineNum = currentLine - startLine;
	const originalLine = originalLines[relativeLineNum];
	if (originalLine === undefined || originalLine === "")
		return <EmptyCodeLine />;

	const lineParts = renderableCodeLineParts(originalLine, language);
	if (lineParts.kind === "plain") return <Text>{lineParts.text}</Text>;

	return (
		<Box flexDirection="row">
			<Text>{lineParts.leading}</Text>
			<Box flexDirection="column">
				<HighlightedCode code={lineParts.code} language={language} />
			</Box>
			<Text>{lineParts.trailing}</Text>
		</Box>
	);
}
function EmptyCodeLine() {
	return <Box height={1} />;
}
