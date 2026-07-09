const WHITESPACE_REGEX = /\s/;

export function isWhitespaceCode(code: number): boolean {
	if (code === 32 || (code >= 9 && code <= 13)) return true;
	if (code < 128) return false;
	return (
		code === 0x00a0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000 ||
		code === 0xfeff
	);
}

export function isWhitespaceChar(char: string | undefined): boolean {
	if (char === undefined) return false;
	const code = char.charCodeAt(0);
	if (isWhitespaceCode(code)) return true;
	if (char.length === 1) return false;
	return WHITESPACE_REGEX.test(char);
}
