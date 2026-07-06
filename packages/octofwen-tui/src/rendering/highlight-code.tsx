import hljs from "highlight.js";
import { Text } from "ink";

export function HighlightedCode({
	code,
	language,
}: {
	code: string;
	language?: string;
}) {
	try {
		const result =
			language && hljs.getLanguage(language)
				? hljs.highlight(code, { language })
				: hljs.highlightAuto(code);

		const segments = parseHighlightedHTML(result.value);
		return <CodeSegments segments={segments} />;
	} catch {
		// If highlighting fails, return plain text lines
		return (
			<>
				{code.split("\n").map((line, index) => (
					<Text key={`code-failed-${index}`}>{line}</Text>
				))}
			</>
		);
	}
}

type CodeSegment = {
	text: string;
	className?: string;
};

function parseHighlightedHTML(html: string): CodeSegment[] {
	const segments: CodeSegment[] = [];
	let currentIndex = 0;

	while (currentIndex < html.length) {
		const nextOpenTag = html.indexOf('<span class="', currentIndex);
		if (nextOpenTag === -1) {
			pushDecodedText(segments, html.slice(currentIndex));
			break;
		}

		pushDecodedText(segments, html.slice(currentIndex, nextOpenTag));

		const parsedSpan = parseHighlightedSpan(html, nextOpenTag);
		if (!parsedSpan) break;

		segments.push(...parsedSpan.segments);
		currentIndex = parsedSpan.nextIndex;
	}

	return segments;
}

function parseHighlightedSpan(
	html: string,
	openTagStart: number,
): { segments: CodeSegment[]; nextIndex: number } | null {
	const classStart = openTagStart + '<span class="'.length;
	const classEnd = html.indexOf('"', classStart);
	const tagEnd = html.indexOf(">", classEnd);
	if (classEnd === -1 || tagEnd === -1) return null;

	const closingTagStart = findClosingSpanTag(html, tagEnd + 1);
	if (closingTagStart === -1) return null;

	const className = html.slice(classStart, classEnd);
	const content = html.slice(tagEnd + 1, closingTagStart);
	const segments = content.includes("<span")
		? parseHighlightedHTML(content)
		: [{ text: decodeHtmlEntities(content), className }];

	return {
		segments,
		nextIndex: closingTagStart + "</span>".length,
	};
}

function findClosingSpanTag(html: string, contentStart: number): number {
	const closingTag = "</span>";
	let openCount = 1;
	let searchFrom = contentStart;
	let closingTagStart = html.indexOf(closingTag, searchFrom);

	while (openCount > 0 && closingTagStart !== -1) {
		const nextOpen = html.indexOf("<span", searchFrom);
		if (nextOpen !== -1 && nextOpen < closingTagStart) {
			openCount++;
			searchFrom = nextOpen + "<span".length;
			continue;
		}

		openCount--;
		if (openCount > 0) {
			searchFrom = closingTagStart + closingTag.length;
			closingTagStart = html.indexOf(closingTag, searchFrom);
		}
	}

	return closingTagStart;
}

function pushDecodedText(segments: CodeSegment[], text: string): void {
	if (text) segments.push({ text: decodeHtmlEntities(text) });
}

function CodeSegments({ segments }: { segments: CodeSegment[] }) {
	const lines: CodeSegment[][] = [];
	let currentLine: CodeSegment[] = [];

	segments.forEach((segment) => {
		const linesInSegment = segment.text.split("\n");

		linesInSegment.forEach((lineText, lineIndex) => {
			if (lineIndex > 0) {
				// This is a new line, push current line and start fresh
				lines.push(currentLine);
				currentLine = [];
			}

			if (lineText || lineIndex === linesInSegment.length - 1) {
				currentLine.push({
					text: lineText,
					className: segment.className,
				});
			}
		});
	});

	// Push the last line if it has content
	if (currentLine.length > 0) {
		lines.push(currentLine);
	}

	return (
		<>
			{lines.map((lineSegments, index) => (
				<CodeLine segments={lineSegments} key={`code-${index}`} />
			))}
		</>
	);
}

function CodeLine({ segments }: { segments: CodeSegment[] }) {
	return (
		<Text>
			{segments.map((segment, index) => {
				const color = segment.className
					? getColorForClass(segment.className)
					: undefined;
				return (
					<Text key={index} color={color}>
						{segment.text}
					</Text>
				);
			})}
		</Text>
	);
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&#x27;/g, "'")
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function getColorForClass(className: string): string | undefined {
	const colorMap: Record<string, string> = {
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

	return colorMap[className];
}
