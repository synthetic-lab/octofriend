import { diffLines } from "diff";
import { Box, Text } from "ink";
import type React from "react";
import { HighlightedCode } from "./highlight-code.tsx";

const CODE_GUTTER_COLOR = "gray";
const DIFF_REMOVED = "#880808";
const DIFF_ADDED = "#405e35";
const LEADING_WHITESPACE_PATTERN = /(^\s+)/;
const TRAILING_WHITESPACE_PATTERN = /(\s+$)/;

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
		const oldLineCounter = buildLineCounter(startLine);
		const newLineCounter = buildLineCounter(startLine);
		const maxOldLines = startLine + countLines(oldText);
		const maxNewLines = startLine + countLines(newText);
		const lineNrWidth = Math.max(numWidth(maxOldLines), numWidth(maxNewLines));

		return (
			<Box flexDirection="column">
				<Box flexDirection="column" marginY={1}>
					<Box>
						<Box width="50%" paddingX={1}>
							<Text color="gray">Old</Text>
						</Box>
						<Box width="50%" paddingX={1}>
							<Text color="gray">New</Text>
						</Box>
					</Box>
					{diffWithChanged.map((part, index) => {
						if (part.added) {
							return (
								<DiffSet
									key={index}
									newValue={part.value}
									newAdded={true}
									language={language}
									oldText={oldText}
									newText={newText}
									oldLineCounter={oldLineCounter}
									newLineCounter={newLineCounter}
									lineNrWidth={lineNrWidth}
								/>
							);
						}

						if (part.removed) {
							return (
								<DiffSet
									key={index}
									oldValue={part.value}
									oldRemoved={true}
									language={language}
									oldText={oldText}
									newText={newText}
									oldLineCounter={oldLineCounter}
									newLineCounter={newLineCounter}
									lineNrWidth={lineNrWidth}
								/>
							);
						}

						if ("changed" in part) {
							return (
								<DiffSet
									key={index}
									oldValue={part.oldValue}
									newValue={part.newValue}
									oldRemoved={true}
									newAdded={true}
									language={language}
									oldText={oldText}
									newText={newText}
									oldLineCounter={oldLineCounter}
									newLineCounter={newLineCounter}
									lineNrWidth={lineNrWidth}
								/>
							);
						}

						return (
							<DiffSet
								key={index}
								oldValue={part.value}
								newValue={part.value}
								language={language}
								oldText={oldText}
								newText={newText}
								oldLineCounter={oldLineCounter}
								newLineCounter={newLineCounter}
								lineNrWidth={lineNrWidth}
							/>
						);
					})}
				</Box>
			</Box>
		);
	} catch (_error) {
		return null;
	}
}

function getStartLine(file: string, search: string) {
	const index = file.indexOf(search);
	if (index < 0) {
		throw new Error(
			"Impossible diff rendering; search string isn't present in file",
		);
	}
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
}: {
	value: string | undefined;
	language: string;
	gutterColor: string;
	gutterWidth: number;
	lineNrWidth: number;
	lineCounter: LineCounter;
	children: React.ReactNode;
	originalText: string;
}) {
	const valueLines = value == null ? [] : value.split("\n");
	if (valueLines.length > 0 && valueLines[valueLines.length - 1] === "") {
		valueLines.pop();
	}
	if (valueLines.length === 0) {
		return (
			<Box width="50%" paddingX={1} flexGrow={1}>
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
		<Box width="50%" paddingX={1} flexDirection="column" flexGrow={1}>
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

		if (relativeLineNum >= originalLines.length) {
			throw new Error(
				`Impossible relative line count: ${relativeLineNum} vs original ${originalLines.length}`,
			);
		}

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
