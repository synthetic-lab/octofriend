export function pathPatternMatches(
	pattern: string,
	filePath: string,
	searchRoot: string,
): boolean {
	if (wildcardMatches(pattern, filePath, false)) return true;
	if (searchRoot === ".") return false;
	return wildcardMatches(pattern, `${searchRoot}/${filePath}`, false);
}

export function wildcardMatches(
	pattern: string,
	value: string,
	caseInsensitive: boolean,
): boolean {
	const matchPattern = caseInsensitive
		? normalizeCaseInsensitiveWildcardText(pattern)
		: pattern;
	const matchValue = caseInsensitive
		? normalizeCaseInsensitiveWildcardText(value)
		: value;
	const fastResult = fastWildcardMatch(matchPattern, matchValue);
	return fastResult ?? wildcardMatchesGeneral(matchPattern, matchValue);
}

function normalizeCaseInsensitiveWildcardText(value: string): string {
	let index = 0;
	while (index < value.length) {
		const code = value.charCodeAt(index);
		if ((code >= 65 && code <= 90) || code > 127) return value.toLowerCase();
		index += 1;
	}
	return value;
}

function fastWildcardMatch(pattern: string, value: string): boolean | null {
	const starIndex = pattern.indexOf("*");
	if (starIndex === -1) {
		return pattern.indexOf("?") === -1 ? pattern === value : null;
	}
	if (pattern.indexOf("?") !== -1) return null;
	if (pattern.indexOf("*", starIndex + 1) !== -1) return null;
	return singleStarWildcardMatches(pattern, value, starIndex);
}

function singleStarWildcardMatches(
	pattern: string,
	value: string,
	starIndex: number,
): boolean {
	if (pattern.length === 1) return true;
	if (starIndex === 0) return endsWithSegment(value, pattern, 1);
	if (starIndex === pattern.length - 1) {
		return startsWithSegment(value, pattern, starIndex);
	}
	return (
		value.length >= pattern.length - 1 &&
		startsWithSegment(value, pattern, starIndex) &&
		endsWithSegment(value, pattern, starIndex + 1)
	);
}

export function wildcardMatchesGeneral(
	pattern: string,
	value: string,
): boolean {
	let patternIndex = 0;
	let valueIndex = 0;
	let backtrackStarIndex = -1;
	let matchIndex = 0;
	while (valueIndex < value.length) {
		const patternCode = codePointAt(pattern, patternIndex);
		const valueCode = codePointAt(value, valueIndex);
		if (patternCode === 63 || patternCode === valueCode) {
			patternIndex = nextCodePointIndex(pattern, patternIndex);
			valueIndex = nextCodePointIndex(value, valueIndex);
		} else if (patternCode === 42) {
			backtrackStarIndex = patternIndex;
			matchIndex = valueIndex;
			patternIndex = nextCodePointIndex(pattern, patternIndex);
		} else if (backtrackStarIndex === -1) {
			return false;
		} else {
			patternIndex = nextCodePointIndex(pattern, backtrackStarIndex);
			matchIndex = nextCodePointIndex(value, matchIndex);
			valueIndex = matchIndex;
		}
	}
	return wildcardPatternExhausted(pattern, patternIndex);
}

function wildcardPatternExhausted(pattern: string, index: number): boolean {
	let patternIndex = index;
	while (codePointAt(pattern, patternIndex) === 42) {
		patternIndex = nextCodePointIndex(pattern, patternIndex);
	}
	return patternIndex === pattern.length;
}

function startsWithSegment(
	value: string,
	pattern: string,
	endExclusive: number,
): boolean {
	if (value.length < endExclusive) return false;
	for (let index = 0; index < endExclusive; index += 1) {
		if (value.charCodeAt(index) !== pattern.charCodeAt(index)) return false;
	}
	return true;
}

function endsWithSegment(
	value: string,
	pattern: string,
	start: number,
): boolean {
	const suffixLength = pattern.length - start;
	if (value.length < suffixLength) return false;
	const valueStart = value.length - suffixLength;
	for (let index = 0; index < suffixLength; index += 1) {
		if (
			value.charCodeAt(valueStart + index) !== pattern.charCodeAt(start + index)
		) {
			return false;
		}
	}
	return true;
}

function codePointAt(value: string, index: number): number {
	return index < value.length ? (value.codePointAt(index) ?? -1) : -1;
}

function nextCodePointIndex(value: string, index: number): number {
	const codePoint = value.codePointAt(index);
	return index + (codePoint !== undefined && codePoint > 0xffff ? 2 : 1);
}
