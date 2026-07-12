import { Box, Text } from "ink";
import type React from "react";
import {
	extractTrim,
	fileExtLanguage,
	numWidth,
} from "../shell/text-processing.ts";
import { DiffRenderer as CodeDiffRenderer } from "./code-diff.tsx";
import { HighlightedCode } from "./highlight.tsx";

const CODE_GUTTER_COLOR = "gray";

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
	const fileLines = splitFileLines(contents);
	const lines = fileLines.length + start;
	const maxWidth = numWidth(lines);
	const gutterWidth = maxWidth + 1;
	const language = fileExtLanguage(filePath);

	return (
		<Box paddingX={1} marginBottom={1} flexDirection="column">
			{renderFileLines(fileLines, start, gutterWidth, language)}
		</Box>
	);
}

function fileLineRow(
	line: string,
	lineIndex: number,
	lineNumber: number,
	gutterWidth: number,
	language: string,
): React.ReactNode {
	const matchedLine = extractTrim(line);
	return (
		<Box key={lineIndex} flexGrow={1}>
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
}

function splitFileLines(contents: string): string[] {
	const lines: string[] = [];
	let lineStart = 0;
	for (let index = 0; index < contents.length; index += 1) {
		const charCode = contents.charCodeAt(index);
		if (charCode !== 10 && charCode !== 13) continue;
		lines[lines.length] = contents.slice(lineStart, index);
		index += charCode === 13 && contents.charCodeAt(index + 1) === 10 ? 1 : 0;
		lineStart = index + 1;
	}
	lines[lines.length] = contents.slice(lineStart);
	return lines;
}

function renderFileLines(
	lines: readonly string[],
	startLine: number,
	gutterWidth: number,
	language: string,
): React.ReactNode[] {
	const rows = new Array<React.ReactNode>(lines.length);
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex] ?? "";
		rows[lineIndex] = fileLineRow(
			line,
			lineIndex,
			startLine + lineIndex,
			gutterWidth,
			language,
		);
	}
	return rows;
}

export const DiffRenderer = CodeDiffRenderer;
