export function previousTextBoundary(
	value: string,
	cursorPosition: number,
): number {
	if (cursorPosition <= 0) return 0;
	const cursor = Math.min(cursorPosition, value.length);
	const previousIndex = cursor - 1;
	if (
		value.charCodeAt(previousIndex) === 10 &&
		value.charCodeAt(previousIndex - 1) === 13
	) {
		return previousIndex - 1;
	}
	if (isPlainAsciiBoundary(value, previousIndex)) return previousIndex;
	let start = previousBaseCodePointStart(value, cursor);
	while (start > 0 && value.charCodeAt(start - 1) === 0x200d) {
		start = previousBaseCodePointStart(value, start - 1);
	}
	return maybePreviousRegionalIndicatorStart(value, start);
}

export function nextTextBoundary(
	value: string,
	cursorPosition: number,
): number {
	if (cursorPosition >= value.length) return value.length;
	if (
		value.charCodeAt(cursorPosition) === 13 &&
		value.charCodeAt(cursorPosition + 1) === 10
	) {
		return cursorPosition + 2;
	}
	if (isPlainAsciiBoundary(value, cursorPosition)) return cursorPosition + 1;
	const firstCodePoint = value.codePointAt(cursorPosition);
	if (firstCodePoint === undefined) return value.length;
	let next = cursorPosition + codePointLength(firstCodePoint);
	next = consumeGraphemeSuffix(value, next);
	if (
		isRegionalIndicator(firstCodePoint) &&
		next < value.length &&
		isRegionalIndicator(value.codePointAt(next) ?? 0)
	) {
		const regionalIndicator = value.codePointAt(next);
		if (regionalIndicator !== undefined) {
			next += codePointLength(regionalIndicator);
			next = consumeGraphemeSuffix(value, next);
		}
	}
	while (next < value.length && value.codePointAt(next) === 0x200d) {
		next += 1;
		const joinedCodePoint = value.codePointAt(next);
		if (joinedCodePoint === undefined) return value.length;
		next += codePointLength(joinedCodePoint);
		next = consumeGraphemeSuffix(value, next);
	}
	return next;
}

function isPlainAsciiBoundary(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) return false;
	if (value.charCodeAt(index) > 0x7f) return false;
	const previousCode = index > 0 ? value.charCodeAt(index - 1) : 0;
	if (previousCode === 0x200d) return false;
	const nextIndex = index + 1;
	if (nextIndex >= value.length) return true;
	const nextCode = value.charCodeAt(nextIndex);
	return nextCode !== 0x200d && nextCode < 0x0300;
}

function previousBaseCodePointStart(
	value: string,
	cursorPosition: number,
): number {
	let start = previousCodePointStart(value, cursorPosition);
	while (start > 0 && isGraphemeSuffix(value.codePointAt(start) ?? 0)) {
		start = previousCodePointStart(value, start);
	}
	return start;
}

function maybePreviousRegionalIndicatorStart(
	value: string,
	start: number,
): number {
	const codePoint = value.codePointAt(start);
	if (codePoint === undefined || !isRegionalIndicator(codePoint)) return start;
	let count = 0;
	let scanStart = start;
	while (scanStart > 0) {
		const previousStart = previousCodePointStart(value, scanStart);
		const previousCodePoint = value.codePointAt(previousStart);
		if (
			previousCodePoint === undefined ||
			!isRegionalIndicator(previousCodePoint)
		) {
			break;
		}
		count += 1;
		scanStart = previousStart;
	}
	return count % 2 === 1 ? previousCodePointStart(value, start) : start;
}

function previousCodePointStart(value: string, cursorPosition: number): number {
	let start = cursorPosition - 1;
	if (
		start > 0 &&
		isLowSurrogate(value.charCodeAt(start)) &&
		isHighSurrogate(value.charCodeAt(start - 1))
	) {
		start -= 1;
	}
	return start;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function consumeGraphemeSuffix(value: string, start: number): number {
	let next = start;
	while (next < value.length) {
		const codePoint = value.codePointAt(next);
		if (codePoint === undefined || !isGraphemeSuffix(codePoint)) return next;
		next += codePointLength(codePoint);
	}
	return next;
}

function codePointLength(codePoint: number): number {
	return codePoint > 0xffff ? 2 : 1;
}

function isGraphemeSuffix(codePoint: number): boolean {
	return (
		isCombiningMark(codePoint) ||
		isVariationSelector(codePoint) ||
		isEmojiModifier(codePoint) ||
		isEmojiTag(codePoint)
	);
}

function isCombiningMark(codePoint: number): boolean {
	return (
		(codePoint >= 0x0300 && codePoint <= 0x036f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f)
	);
}

function isVariationSelector(codePoint: number): boolean {
	return (
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		(codePoint >= 0xe0100 && codePoint <= 0xe01ef)
	);
}

function isEmojiModifier(codePoint: number): boolean {
	return codePoint >= 0x1f3fb && codePoint <= 0x1f3ff;
}

function isEmojiTag(codePoint: number): boolean {
	return codePoint >= 0xe0020 && codePoint <= 0xe007f;
}

function isRegionalIndicator(codePoint: number): boolean {
	return codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff;
}
