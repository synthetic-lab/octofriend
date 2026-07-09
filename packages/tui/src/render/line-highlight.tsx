import { Box, Text } from "ink";
import type React from "react";
import type { CodeSegment } from "./html-highlight";
import { nextRenderedLineBreak } from "./lines";

const HIGHLIGHT_CLASS_COLORS: Record<string, string> = {
	"hljs-keyword": "blue",
	"hljs-string": "green",
	"hljs-comment": "gray",
	"hljs-number": "yellow",
	"hljs-title": "cyan",
	"hljs-title function_": "cyan",
	"hljs-variable": "magenta",
	"hljs-type": "blue",
	"hljs-attr": "yellow",
	"hljs-built_in": "red",
	"hljs-literal": "cyan",
	"hljs-name": "cyan",
	"hljs-selector-tag": "blue",
	"hljs-selector-class": "yellow",
	"hljs-selector-id": "magenta",
	"hljs-property": "cyan",
	"hljs-value": "green",
};

export function renderPlainCodeLines(code: string): React.ReactNode[] {
	const rows: React.ReactNode[] = [];
	let lineStart = 0;
	let lineIndex = 0;
	while (lineStart <= code.length) {
		const lineBreak = nextRenderedLineBreak(code, lineStart);
		const line = code.slice(lineStart, lineBreak.index);
		rows[lineIndex] = line ? (
			<Text key={lineIndex}>{line}</Text>
		) : (
			<EmptyCodeLine key={lineIndex} />
		);
		lineIndex += 1;
		if (lineBreak.length === 0) break;
		lineStart = lineBreak.index + lineBreak.length;
	}
	return rows;
}

export function renderCodeSegments(
	segments: readonly CodeSegment[],
): React.ReactNode[] {
	const lines: CodeSegment[][] = [];
	let currentLine: CodeSegment[] = [];

	let segmentIndex = 0;
	while (segmentIndex < segments.length) {
		const segment = segments[segmentIndex];
		segmentIndex += 1;
		if (segment === undefined) continue;

		currentLine = appendSegmentLines(lines, currentLine, segment);
	}

	if (currentLine.length > 0) {
		lines[lines.length] = currentLine;
	}

	return renderCodeLines(lines);
}

function appendSegmentLines(
	lines: CodeSegment[][],
	initialLine: CodeSegment[],
	segment: CodeSegment,
): CodeSegment[] {
	let currentLine = initialLine;
	let lineStart = 0;
	while (lineStart <= segment.text.length) {
		const lineBreak = nextRenderedLineBreak(segment.text, lineStart);
		const lineText = segment.text.slice(lineStart, lineBreak.index);
		if (lineText || lineBreak.length === 0) {
			currentLine[currentLine.length] = {
				text: lineText,
				className: segment.className,
			};
		}
		if (lineBreak.length === 0) break;

		lines[lines.length] = currentLine;
		currentLine = [];
		lineStart = lineBreak.index + lineBreak.length;
	}
	return currentLine;
}

function renderCodeLines(lines: readonly CodeSegment[][]): React.ReactNode[] {
	const rows = new Array<React.ReactNode>(lines.length);
	let rowIndex = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const lineSegments = lines[index];
		if (lineSegments === undefined) continue;
		rows[rowIndex] = <CodeLine segments={lineSegments} key={index} />;
		rowIndex += 1;
	}
	rows.length = rowIndex;
	return rows;
}

function CodeLine({ segments }: { segments: CodeSegment[] }) {
	const nodes = renderCodeLineSegments(segments);
	if (nodes.length === 0) return <EmptyCodeLine />;
	return <Text>{nodes}</Text>;
}

function EmptyCodeLine() {
	return <Box height={1} />;
}

function renderCodeLineSegments(
	segments: readonly CodeSegment[],
): React.ReactNode[] {
	const nodes = new Array<React.ReactNode>(segments.length);
	let nodeIndex = 0;
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		if (segment === undefined || segment.text === "") continue;
		const color = segment.className
			? getColorForClass(segment.className)
			: undefined;
		nodes[nodeIndex] = (
			<Text key={index} color={color}>
				{segment.text}
			</Text>
		);
		nodeIndex += 1;
	}
	nodes.length = nodeIndex;
	return nodes;
}

function getColorForClass(className: string): string | undefined {
	return HIGHLIGHT_CLASS_COLORS[className];
}
