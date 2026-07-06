import { diffLines } from "diff";
import { Box, Text } from "ink";
import type React from "react";
import { useTerminalSize } from "../layout/viewport.tsx";
import { HighlightedCode } from "./highlight-code.tsx";

const CODE_GUTTER_COLOR = "gray";
const DIFF_REMOVED = "#880808";
const DIFF_ADDED = "#405e35";
const LEADING_WHITESPACE_PATTERN = /(^\s+)/;
const TRAILING_WHITESPACE_PATTERN = /(\s+$)/;
const STACKED_DIFF_MAX_TERMINAL_WIDTH = 80;

export function FileRenderer({
	contents,
	filePath,
	startLineNr,
}: {
	contents: string;
	filePath: string;
	startLineNr?: number;
}) {
	const start = startLineNr || 1;
	const lines = countLines(contents) + start;
	const maxWidth = numWidth(lines);
	const gutterWidth = maxWidth + 1;
	const language = fileExtLanguage(filePath);
	let currentLine = start;

	return (
		<Box paddingX={1} marginBottom={1} flexDirection="column">
			{contents.split("\n").map((line, index) => {
				const lineNumber = currentLine++;
				const matchedLine = extractTrim(line);

				return (
					<Box key={`${index}-${line}`} flexGrow={1}>
						<Box
							width={gutterWidth}
							flexShrink={0}
							flexGrow={1}
							backgroundColor={CODE_GUTTER_COLOR}
							marginRight={1}
						>
							<Text>{lineNumber}</Text>
						</Box>
						<Box flexGrow={1} width="100%" flexDirection="column">
							<Box flexDirection="row">
								<Text>{matchedLine[0]}</Text>
								<Box flexDirection="column">
									<HighlightedCode code={matchedLine[1]} language={language} />
								</Box>
								<Text>{matchedLine[2]}</Text>
							</Box>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}

export function DiffRenderer({
	oldText,
	newText,
	fileContents,
	filepath,
}: {
	oldText: string;
	newText: string;
	fileContents: string;
	filepath: string;
}) {
	const terminalSize = useTerminalSize();
	const diffLayout =
		terminalSize.width <= STACKED_DIFF_MAX_TERMINAL_WIDTH
			? "stacked"
			: "side-by-side";

	try {
		const language = fileExtLanguage(filepath);

		const diff = diffLines(oldText, newText);
		const diffWithChanged: Array<
			| (typeof diff)[number]
			| {
					added: false;
					removed: false;
					changed: true;
					oldValue: string;
					newValue: string;
			  }
		> = [];

		for (const curr of diff) {
			const prev =
				diffWithChanged.length === 0
					? null
					: diffWithChanged[diffWithChanged.length - 1];
			if (prev == null) {
				diffWithChanged.push(curr);
				continue;
			}
			if (prev.removed && curr.added) {
				diffWithChanged.pop();
				diffWithChanged.push({
					added: false,
					removed: false,
					changed: true,
					oldValue: prev.value,
					newValue: curr.value,
				});
				continue;
			}
			diffWithChanged.push(curr);
		}

		const startLine = getStartLine(fileContents, oldText);
		if (startLine == null) return null;
		const oldLineCounter = buildLineCounter(startLine);
		const newLineCounter = buildLineCounter(startLine);
		const maxOldLines = startLine + countLines(oldText);
		const maxNewLines = startLine + countLines(newText);
		const lineNrWidth = Math.max(numWidth(maxOldLines), numWidth(maxNewLines));

		return (
			<Box flexDirection="column">
				<Box flexDirection="column" marginY={1}>
					{diffLayout === "stacked" ? (
						<StackedDiff
							diffParts={diffWithChanged}
							language={language}
							lineNrWidth={lineNrWidth}
							oldLineCounter={oldLineCounter}
							newLineCounter={newLineCounter}
							oldText={oldText}
							newText={newText}
						/>
					) : (
						<SideBySideDiff
							diffParts={diffWithChanged}
							language={language}
							lineNrWidth={lineNrWidth}
							oldLineCounter={oldLineCounter}
							newLineCounter={newLineCounter}
							oldText={oldText}
							newText={newText}
						/>
					)}
				</Box>
			</Box>
		);
	} catch (_error) {
		return null;
	}
}

type DiffPart =
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
	oldText: string;
	newText: string;
};

function SideBySideDiff({
	diffParts,
	language,
	lineNrWidth,
	oldLineCounter,
	newLineCounter,
	oldText,
	newText,
}: DiffPartsProps) {
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
			{diffParts.map((part, index) => (
				<DiffSet
					key={index}
					{...diffSetValues(part)}
					language={language}
					oldText={oldText}
					newText={newText}
					oldLineCounter={oldLineCounter}
					newLineCounter={newLineCounter}
					lineNrWidth={lineNrWidth}
				/>
			))}
		</>
	);
}

function StackedDiff({
	diffParts,
	language,
	lineNrWidth,
	oldLineCounter,
	newLineCounter,
	oldText,
	newText,
}: DiffPartsProps) {
	return (
		<>
			<Box paddingX={1}>
				<Text color="gray">Old</Text>
			</Box>
			{diffParts.map((part, index) => (
				<DiffSide
					key={`old-${index}`}
					side="old"
					{...diffSetValues(part)}
					language={language}
					lineCounter={oldLineCounter}
					lineNrWidth={lineNrWidth}
					text={oldText}
				/>
			))}
			<Box paddingX={1} marginTop={1}>
				<Text color="gray">New</Text>
			</Box>
			{diffParts.map((part, index) => (
				<DiffSide
					key={`new-${index}`}
					side="new"
					{...diffSetValues(part)}
					language={language}
					lineCounter={newLineCounter}
					lineNrWidth={lineNrWidth}
					text={newText}
				/>
			))}
		</>
	);
}

function diffSetValues(part: DiffPart): {
	oldValue?: string;
	newValue?: string;
	oldRemoved?: boolean;
	newAdded?: boolean;
} {
	if (part.added) {
		return { newValue: part.value, newAdded: true };
	}
	if (part.removed) {
		return { oldValue: part.value, oldRemoved: true };
	}
	if ("changed" in part) {
		return {
			oldValue: part.oldValue,
			newValue: part.newValue,
			oldRemoved: true,
			newAdded: true,
		};
	}
	return { oldValue: part.value, newValue: part.value };
}

function DiffSide({
	side,
	oldValue,
	newValue,
	oldRemoved,
	newAdded,
	language,
	lineCounter,
	lineNrWidth,
	text,
}: {
	side: "old" | "new";
	oldValue?: string;
	newValue?: string;
	oldRemoved?: boolean;
	newAdded?: boolean;
	language: string;
	lineCounter: LineCounter;
	lineNrWidth: number;
	text: string;
}) {
	const value = side === "old" ? oldValue : newValue;
	if (value == null) return null;

	const changed = side === "old" ? oldRemoved : newAdded;
	return (
		<LineSegments
			value={value}
			language={language}
			gutterWidth={3 + lineNrWidth}
			lineNrWidth={lineNrWidth}
			gutterColor={
				changed
					? side === "old"
						? DIFF_REMOVED
						: DIFF_ADDED
					: CODE_GUTTER_COLOR
			}
			lineCounter={lineCounter}
			originalText={text}
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

function getStartLine(file: string, search: string) {
	const index = file.indexOf(search);
	if (index < 0) return null;
	let line = 1;
	for (let i = 0; i < index; i++) {
		const char = file[i];
		if (char === "\n") line++;
	}
	return line;
}

type LineCounter = {
	getLine: () => number;
	incrementLine: () => number;
	getStartLine: () => number;
};

function buildLineCounter(startLine: number): LineCounter {
	let curr = startLine;
	return {
		getLine: () => curr,
		incrementLine: () => curr++,
		getStartLine: () => startLine,
	};
}

function DiffSet({
	oldValue,
	newValue,
	newAdded,
	oldRemoved,
	language,
	oldLineCounter,
	newLineCounter,
	lineNrWidth,
	oldText,
	newText,
}: {
	oldValue?: string;
	newValue?: string;
	oldRemoved?: boolean;
	newAdded?: boolean;
	oldLineCounter: LineCounter;
	newLineCounter: LineCounter;
	lineNrWidth: number;
	language: string;
	oldText: string;
	newText: string;
}) {
	const gutterWidth = 3 + lineNrWidth;
	return (
		<Box flexDirection="row">
			<LineSegments
				value={oldValue}
				language={language}
				gutterWidth={gutterWidth}
				lineNrWidth={lineNrWidth}
				gutterColor={oldRemoved ? DIFF_REMOVED : CODE_GUTTER_COLOR}
				lineCounter={oldLineCounter}
				originalText={oldText}
			>
				{oldRemoved ? <Text color="black"> - </Text> : <Text>{"  "}</Text>}
			</LineSegments>
			<LineSegments
				value={newValue}
				language={language}
				gutterWidth={gutterWidth}
				lineNrWidth={lineNrWidth}
				gutterColor={newAdded ? DIFF_ADDED : CODE_GUTTER_COLOR}
				lineCounter={newLineCounter}
				originalText={newText}
			>
				{newAdded ? <Text color="black"> + </Text> : <Text>{"  "}</Text>}
			</LineSegments>
		</Box>
	);
}

function LineSegments({
	value,
	language,
	gutterColor,
	gutterWidth,
	lineNrWidth,
	lineCounter,
	children,
	originalText,
	paneWidth = "50%",
}: {
	value: string | undefined;
	language: string;
	gutterColor: string;
	gutterWidth: number;
	lineNrWidth: number;
	lineCounter: LineCounter;
	children: React.ReactNode;
	originalText: string;
	paneWidth?: string;
}) {
	const valueLines = value == null ? [] : value.split("\n");
	if (valueLines.length > 0 && valueLines[valueLines.length - 1] === "") {
		valueLines.pop();
	}
	if (valueLines.length === 0) {
		return (
			<Box width={paneWidth} paddingX={1} flexGrow={1}>
				<Box
					width={gutterWidth}
					flexShrink={0}
					flexGrow={1}
					backgroundColor={gutterColor}
					marginRight={1}
				>
					<Box width={lineNrWidth} flexShrink={0}>
						<Text> </Text>
					</Box>
					{children}
				</Box>
				<Box flexGrow={1} width="100%" flexDirection="column">
					<Text> </Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box width={paneWidth} paddingX={1} flexDirection="column" flexGrow={1}>
			{valueLines.map((line, index) => {
				const lineNumber = lineCounter.incrementLine();
				return (
					<Box key={`${index}-${line}`} flexGrow={1}>
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
								line={line}
								language={language}
								originalText={originalText}
								currentLine={lineNumber}
								startLine={lineCounter.getStartLine()}
							/>
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}

function whitespaceWidth(ws: string): number {
	let width = 0;
	for (const char of ws) {
		if (char === "\t") width += 2;
		else width += 1;
	}
	return width;
}

function MaybeHighlighted({
	line,
	language,
	originalText,
	currentLine,
	startLine,
}: {
	line: string | undefined;
	language: string;
	originalText: string;
	currentLine: number;
	startLine: number;
}) {
	const matchedLine = (() => {
		if (line == null) return line;

		const relativeLineNum = currentLine - startLine;
		const originalLines = originalText.split("\n");

		if (relativeLineNum >= originalLines.length) return null;

		const originalLine = originalLines[relativeLineNum];
		return extractTrim(originalLine);
	})();

	if (language === "txt") {
		if (matchedLine) {
			return (
				<Box paddingLeft={whitespaceWidth(matchedLine[0])}>
					<Text>
						{matchedLine[1]}
						{matchedLine[2]}
					</Text>
				</Box>
			);
		}
		return <Text> </Text>;
	}

	if (matchedLine) {
		return (
			<Box flexDirection="column" paddingLeft={whitespaceWidth(matchedLine[0])}>
				<HighlightedCode code={matchedLine[1]} language={language} />
			</Box>
		);
	}

	return <Text> </Text>;
}

function countLines(content: string) {
	return content.split("\n").length;
}

function numWidth(num: number) {
	return num.toString().length;
}

function fileExtLanguage(filePath: string) {
	const dotParts = filePath.split(".");
	let language = "txt";
	if (dotParts.length > 1) language = dotParts[dotParts.length - 1];
	return language;
}

function extractTrim(line: string): [string, string, string] {
	let spaceBefore = "";
	let spaceAfter = "";

	const leadingWhitespace = line.match(LEADING_WHITESPACE_PATTERN);
	const trailingWhitespace = line.match(TRAILING_WHITESPACE_PATTERN);

	if (leadingWhitespace) spaceBefore = leadingWhitespace[1];
	if (trailingWhitespace) spaceAfter = trailingWhitespace[1];

	return [spaceBefore, line.trim(), spaceAfter];
}
