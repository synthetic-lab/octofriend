const WHITESPACE_PATTERN = /\s/;

export function firstNonEmptyStdoutLine(stdout: string): string | null {
	let lineStart = 0;
	for (let index = 0; index <= stdout.length; index += 1) {
		const isEnd = index === stdout.length;
		if (!isEnd && stdout.charCodeAt(index) !== 10) continue;

		if (lineHasNonWhitespace(stdout, lineStart, index)) {
			return stdout.slice(lineStart, index);
		}
		if (isEnd) break;
		lineStart = index + 1;
	}
	return null;
}

function lineHasNonWhitespace(
	text: string,
	start: number,
	end: number,
): boolean {
	for (let index = start; index < end; index += 1) {
		if (!isWhitespaceCode(text.charCodeAt(index))) return true;
	}
	return false;
}

function isWhitespaceCode(charCode: number): boolean {
	if (charCode === 32) return true;
	if (charCode >= 9 && charCode <= 13) return true;
	return WHITESPACE_PATTERN.test(String.fromCharCode(charCode));
}
