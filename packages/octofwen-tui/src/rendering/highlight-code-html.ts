const SPAN_CLASS_PREFIX = '<span class="';
const OPEN_SPAN_PREFIX = "<span";
const CLOSING_SPAN_TAG = "</span>";

export type CodeSegment = {
	text: string;
	className?: string;
};

export function parseHighlightedHTML(html: string): CodeSegment[] {
	const segments: CodeSegment[] = [];
	let currentIndex = 0;

	while (currentIndex < html.length) {
		const nextOpenTag = findNextSpanClass(html, currentIndex);
		if (nextOpenTag === -1) {
			pushDecodedText(segments, html.slice(currentIndex));
			break;
		}

		pushDecodedText(segments, html.slice(currentIndex, nextOpenTag));

		const parsedSpan = parseHighlightedSpan(html, nextOpenTag);
		if (!parsedSpan) {
			pushDecodedText(segments, html.slice(nextOpenTag));
			break;
		}

		appendSegments(segments, parsedSpan.segments);
		currentIndex = parsedSpan.nextIndex;
	}

	return segments;
}

function findNextSpanClass(html: string, start: number): number {
	return html.indexOf(SPAN_CLASS_PREFIX, start);
}

function appendSegments(target: CodeSegment[], source: readonly CodeSegment[]) {
	let index = 0;
	while (index < source.length) {
		const segment = source[index];
		if (segment !== undefined) target[target.length] = segment;
		index += 1;
	}
}

function parseHighlightedSpan(
	html: string,
	openTagStart: number,
): { segments: CodeSegment[]; nextIndex: number } | null {
	const classStart = openTagStart + SPAN_CLASS_PREFIX.length;
	const classEnd = html.indexOf('"', classStart);
	const tagEnd = html.indexOf(">", classEnd);
	if (classEnd === -1 || tagEnd === -1) return null;

	const closingTagStart = findClosingSpanTag(html, tagEnd + 1);
	if (closingTagStart === -1) return null;

	const className = html.slice(classStart, classEnd);
	const contentStart = tagEnd + 1;
	const nestedSpan = html.indexOf(OPEN_SPAN_PREFIX, contentStart);
	const content = html.slice(contentStart, closingTagStart);
	const segments =
		nestedSpan !== -1 && nestedSpan < closingTagStart
			? parseHighlightedHTML(content)
			: [{ text: decodeHtmlEntities(content), className }];

	return {
		segments,
		nextIndex: closingTagStart + CLOSING_SPAN_TAG.length,
	};
}

function findClosingSpanTag(html: string, contentStart: number): number {
	let openCount = 1;
	let index = contentStart;
	while (index < html.length) {
		if (html.charCodeAt(index) !== 60) {
			index += 1;
			continue;
		}
		if (html.startsWith(OPEN_SPAN_PREFIX, index)) {
			openCount += 1;
			index += OPEN_SPAN_PREFIX.length;
			continue;
		}
		if (html.startsWith(CLOSING_SPAN_TAG, index)) {
			openCount -= 1;
			if (openCount === 0) return index;
			index += CLOSING_SPAN_TAG.length;
			continue;
		}
		index += 1;
	}

	return -1;
}

function pushDecodedText(segments: CodeSegment[], text: string): void {
	if (text) segments[segments.length] = { text: decodeHtmlEntities(text) };
}

type HtmlEntityReplacement = {
	length: number;
	value: string;
};

function decodeHtmlEntities(text: string): string {
	const firstAmp = text.indexOf("&");
	if (firstAmp === -1) return text;

	let parts: string[] | undefined;
	let copyStart = 0;
	for (let index = firstAmp; index < text.length; index += 1) {
		if (text.charCodeAt(index) !== 38) continue;
		const replacement = htmlEntityReplacement(text, index);
		if (replacement === undefined) continue;
		parts ??= [];
		if (copyStart < index) parts[parts.length] = text.slice(copyStart, index);
		parts[parts.length] = replacement.value;
		index += replacement.length - 1;
		copyStart = index + 1;
	}
	if (parts === undefined) return text;
	if (copyStart < text.length) parts[parts.length] = text.slice(copyStart);
	return parts.join("");
}

function htmlEntityReplacement(
	text: string,
	start: number,
): HtmlEntityReplacement | undefined {
	switch (text.charCodeAt(start + 1)) {
		case 35:
			return numericEntityReplacement(text, start);
		case 97:
			return aEntityReplacement(text, start);
		case 103:
			return namedEntityReplacement(text, start, "gt;", ">");
		case 108:
			return namedEntityReplacement(text, start, "lt;", "<");
		case 113:
			return namedEntityReplacement(text, start, "quot;", '"');
		default:
			return undefined;
	}
}

function numericEntityReplacement(
	text: string,
	start: number,
): HtmlEntityReplacement | undefined {
	const semicolon = text.indexOf(";", start + 2);
	if (semicolon === -1) return undefined;

	const valueStart = isHexNumericEntity(text, start) ? start + 3 : start + 2;
	if (valueStart >= semicolon) return undefined;

	const radix = valueStart === start + 3 ? 16 : 10;
	let codePoint = 0;
	for (let index = valueStart; index < semicolon; index += 1) {
		const digit = numericEntityDigit(text.charCodeAt(index), radix);
		if (digit === -1) return undefined;
		codePoint = codePoint * radix + digit;
		if (codePoint > 0x10ffff) return undefined;
	}

	if (codePoint >= 0xd800 && codePoint <= 0xdfff) return undefined;
	return {
		length: semicolon - start + 1,
		value: String.fromCodePoint(codePoint),
	};
}

function isHexNumericEntity(text: string, start: number): boolean {
	const code = text.charCodeAt(start + 2);
	return code === 88 || code === 120;
}

function numericEntityDigit(charCode: number, radix: number): number {
	if (charCode >= 48 && charCode <= 57) return charCode - 48;
	if (radix === 10) return -1;
	if (charCode >= 65 && charCode <= 70) return charCode - 55;
	if (charCode >= 97 && charCode <= 102) return charCode - 87;
	return -1;
}

function aEntityReplacement(
	text: string,
	start: number,
): HtmlEntityReplacement | undefined {
	return (
		namedEntityReplacement(text, start, "amp;", "&") ??
		namedEntityReplacement(text, start, "apos;", "'")
	);
}

function namedEntityReplacement(
	text: string,
	start: number,
	entityTail: string,
	value: string,
): HtmlEntityReplacement | undefined {
	if (!text.startsWith(entityTail, start + 1)) return undefined;
	return { length: entityTail.length + 1, value };
}
