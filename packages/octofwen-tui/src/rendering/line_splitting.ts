export type RenderedLineBreak = {
	readonly index: number;
	readonly length: number;
};

export function nextRenderedLineBreak(
	text: string,
	start: number,
): RenderedLineBreak {
	for (let index = start; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 10 && code !== 13) continue;
		return {
			index,
			length: code === 13 && text.charCodeAt(index + 1) === 10 ? 2 : 1,
		};
	}
	return { index: text.length, length: 0 };
}

export function normalizeRenderedLineBreaks(text: string): string {
	const firstCr = text.indexOf("\r");
	if (firstCr === -1) return text;
	const parts: string[] = [];
	let writeStart = 0;
	for (let index = firstCr; index < text.length; index += 1) {
		if (text.charCodeAt(index) !== 13) continue;
		parts[parts.length] = text.slice(writeStart, index);
		parts[parts.length] = "\n";
		if (text.charCodeAt(index + 1) === 10) index += 1;
		writeStart = index + 1;
	}
	parts[parts.length] = text.slice(writeStart);
	return parts.join("");
}

export function splitLfLines(text: string): string[] {
	const firstLf = text.indexOf("\n");
	if (firstLf === -1) return [text];
	let lineStart = 0;
	const lines: string[] = [];
	for (let index = firstLf; index < text.length; index += 1) {
		if (text.charCodeAt(index) !== 10) continue;
		lines[lines.length] = text.slice(lineStart, index);
		lineStart = index + 1;
	}
	lines[lines.length] = text.slice(lineStart);
	return lines;
}

export function splitLfLinesDropTrailingEmpty(
	text: string | undefined,
): string[] {
	if (text == null) return [];
	const lines = splitLfLines(text);
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}
	return lines;
}

export function countLfLinesDropTrailingEmpty(
	text: string | undefined,
): number {
	if (text == null) return 0;
	if (text.length === 0) return 0;
	const firstLf = text.indexOf("\n");
	if (firstLf === -1) return 1;
	let count = 1;
	for (let index = firstLf; index < text.length; index += 1) {
		if (text.charCodeAt(index) === 10) count += 1;
	}
	return text.charCodeAt(text.length - 1) === 10 ? count - 1 : count;
}

export function splitRenderedLines(text: string): string[] {
	const lines: string[] = [];
	let lineStart = 0;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 10 && code !== 13) continue;
		lines[lines.length] = text.slice(lineStart, index);
		if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1;
		lineStart = index + 1;
	}
	lines[lines.length] = text.slice(lineStart);
	return lines;
}

export function countRenderedLines(text: string): number {
	let lineCount = 1;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 10 && code !== 13) continue;
		lineCount += 1;
		if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1;
	}
	return lineCount;
}

export function countRenderedLinesDropTrailingEmpty(
	text: string | undefined,
): number {
	if (text == null || text.length === 0) return 0;
	let count = 1;
	let lastBreakEnd = -1;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code !== 10 && code !== 13) continue;
		count += 1;
		if (code === 13 && text.charCodeAt(index + 1) === 10) index += 1;
		lastBreakEnd = index;
	}
	return lastBreakEnd === text.length - 1 ? count - 1 : count;
}
