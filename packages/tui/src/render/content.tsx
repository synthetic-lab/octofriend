import { Box, Text } from "ink";
import type React from "react";
import type { ImageInfo } from "../input/images.ts";
import type { Content } from "../runtime/models/ir/main.ts";
import {
	countRenderedLinesDropTrailingEmpty,
	nextRenderedLineBreak,
	normalizeRenderedLineBreaks,
} from "./lines.ts";

export type TerminalContent = Content["content"];

type ToolOutputSummary = {
	lineCount: number;
	imageParts: Extract<TerminalContent[number], { type: "image" }>[];
};

export function summarizeToolOutputContent(
	content: TerminalContent,
): ToolOutputSummary {
	let lineCount = 0;
	const imageParts = new Array<ToolOutputSummary["imageParts"][number]>(
		content.length,
	);
	let index = 0;
	let imageIndex = 0;
	while (index < content.length) {
		const part = content[index];
		index += 1;
		if (part === undefined) continue;
		if (part.type === "text") {
			lineCount += countRenderedLinesDropTrailingEmpty(part.content);
		} else {
			imageParts[imageIndex] = part;
			imageIndex += 1;
		}
	}
	if (imageIndex < imageParts.length) imageParts.length = imageIndex;
	return { lineCount, imageParts };
}

export function countToolOutputTextLines(content: TerminalContent): number {
	let lineCount = 0;
	let index = 0;
	while (index < content.length) {
		const part = content[index];
		index += 1;
		if (part !== undefined && part.type === "text") {
			lineCount += countRenderedLinesDropTrailingEmpty(part.content);
		}
	}
	return lineCount;
}

export function toolOutputLineCountText(lineCount: number): string {
	return `Got ${lineCount} ${lineCount === 1 ? "line" : "lines"} of output`;
}

export function ToolOutputContentRenderer({
	content,
	showText = false,
}: {
	content: TerminalContent;
	showText?: boolean;
}) {
	const lineCount = countToolOutputTextLines(content);

	return (
		<Box marginLeft={2} flexDirection="column">
			<Text color="gray">{toolOutputLineCountText(lineCount)}</Text>
			{showText && renderToolOutputText(content)}
			{renderToolOutputImages(content)}
		</Box>
	);
}

function renderToolOutputText(
	content: TerminalContent,
): React.ReactNode[] | null {
	const rows: React.ReactNode[] = [];
	for (let index = 0; index < content.length; index += 1) {
		const part = content[index];
		if (part?.type !== "text" || part.content.length === 0) continue;
		rows.push(
			<Text key={index}>{normalizeRenderedLineBreaks(part.content)}</Text>,
		);
	}
	return rows.length === 0 ? null : rows;
}

function renderToolOutputImages(
	content: TerminalContent,
): React.ReactNode[] | null {
	let rows: React.ReactNode[] | undefined;
	let writeIndex = 0;
	for (let index = 0; index < content.length; index += 1) {
		const part = content[index];
		if (part === undefined || part.type !== "image") continue;
		rows ??= [];
		rows[writeIndex] = <ImageContentRenderer key={index} image={part.image} />;
		writeIndex += 1;
	}
	return rows ?? null;
}

export function ToolOutputTextRenderer({
	content,
	image,
}: {
	content: string;
	image?: ImageInfo;
}) {
	const lineCount = countRenderedLinesDropTrailingEmpty(content);

	return (
		<Box marginLeft={2} flexDirection="column">
			<Text color="gray">{toolOutputLineCountText(lineCount)}</Text>
			{image !== undefined && <ImageContentRenderer image={image} />}
		</Box>
	);
}

export function ContentRenderer({
	content,
	textColor,
}: {
	content: TerminalContent;
	textColor?: string;
}) {
	return (
		<Box flexDirection="column">{renderContentParts(content, textColor)}</Box>
	);
}

function renderContentParts(
	content: TerminalContent,
	textColor: string | undefined,
): React.ReactNode[] {
	const rows: React.ReactNode[] = [];
	let writeIndex = 0;
	for (let index = 0; index < content.length; index += 1) {
		const part = content[index];
		if (part === undefined) continue;
		if (part.type === "image") {
			rows[writeIndex] = (
				<ImageContentRenderer key={index} image={part.image} />
			);
			writeIndex += 1;
			continue;
		}
		writeIndex = appendContentTextLines(
			rows,
			writeIndex,
			part.content,
			index,
			textColor,
			false,
		);
	}
	return rows;
}

export function renderContentTextLines(
	content: string,
	partIndex: number,
	textColor?: string,
	boxed = false,
): React.ReactNode[] {
	const rows: React.ReactNode[] = [];
	appendContentTextLines(rows, 0, content, partIndex, textColor, boxed);
	return rows;
}

function contentTextLineNode(
	line: string,
	key: number,
	textColor: string | undefined,
	boxed: boolean,
): React.ReactNode {
	if (line === "") return <Box key={key} height={1} />;
	if (!boxed) {
		return (
			<Text key={key} color={textColor}>
				{line}
			</Text>
		);
	}
	return (
		<Box key={key}>
			<Text color={textColor}>{line}</Text>
		</Box>
	);
}

export function appendContentTextLines(
	rows: React.ReactNode[],
	writeIndex: number,
	content: string,
	partIndex: number,
	textColor: string | undefined,
	boxed: boolean,
): number {
	let lineStart = 0;
	let lineIndex = 0;
	let nextWriteIndex = writeIndex;
	const keyBase = (partIndex + 1) * 1_000_000;
	while (lineStart <= content.length) {
		const lineBreak = nextRenderedLineBreak(content, lineStart);
		const key = -(keyBase + lineIndex);
		rows[nextWriteIndex] = contentTextLineNode(
			content.slice(lineStart, lineBreak.index),
			key,
			textColor,
			boxed,
		);
		nextWriteIndex += 1;
		lineIndex += 1;
		if (lineBreak.length === 0) break;
		lineStart = lineBreak.index + lineBreak.length;
	}
	return nextWriteIndex;
}

export function ImageContentRenderer({ image }: { image: ImageInfo }) {
	return (
		<Text inverse={true}>
			⟦ 📎 {image.filePath} ({Math.ceil(image.sizeBytes / 1024)} KB) ⟧
		</Text>
	);
}
