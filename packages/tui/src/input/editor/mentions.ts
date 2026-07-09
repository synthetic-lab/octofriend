export function fileSuggestionTrigger(
	input: string,
): { triggerPosition: number; query: string } | null {
	let atIndex = input.lastIndexOf("@");
	while (atIndex !== -1) {
		if (
			isMentionStartBoundary(input, atIndex) &&
			isFileSuggestionQuery(input, atIndex + 1)
		) {
			return { triggerPosition: atIndex, query: input.slice(atIndex + 1) };
		}
		atIndex = input.lastIndexOf("@", atIndex - 1);
	}
	return null;
}

function isFileSuggestionQuery(input: string, queryStart: number): boolean {
	let index = queryStart;
	while (index < input.length) {
		const code = input.charCodeAt(index);
		if (
			(code >= 48 && code <= 57) ||
			(code >= 65 && code <= 90) ||
			code === 95 ||
			(code >= 97 && code <= 122) ||
			code === 45 ||
			code === 46 ||
			code === 47
		) {
			index += 1;
			continue;
		}
		return false;
	}
	return true;
}

export function pruneSelectedMentions(
	input: string,
	selectedSuggestions: Set<string>,
): void {
	if (selectedSuggestions.size === 0) return;
	const firstAtIndex = input.indexOf("@");
	if (firstAtIndex === -1) {
		selectedSuggestions.clear();
		return;
	}
	for (const filename of selectedSuggestions) {
		if (!hasSelectedMention(input, firstAtIndex, filename)) {
			selectedSuggestions.delete(filename);
		}
	}
}

export function replaceSelectedMentions(
	input: string,
	selectedSuggestions: Set<string>,
): string {
	if (selectedSuggestions.size === 0) return input;
	const firstAtIndex = input.indexOf("@");
	if (firstAtIndex === -1) return input;

	if (selectedSuggestions.size === 1) {
		const filename = selectedSuggestions.values().next().value;
		if (filename === undefined) return input;
		return replaceSingleSelectedMention(
			input,
			firstAtIndex,
			filename,
			normalizeMentionPath(filename),
		);
	}

	return replaceMultipleSelectedMentions(
		input,
		firstAtIndex,
		selectedMentionPathIndex(selectedSuggestions),
	);
}

type SelectedMentionPath = {
	filename: string;
	normalizedPath: string;
};

type SelectedMentionPathIndex = Map<number, SelectedMentionPath[]>;

function selectedMentionPathIndex(
	selectedSuggestions: Set<string>,
): SelectedMentionPathIndex {
	const pathsByFirstCode: SelectedMentionPathIndex = new Map();
	for (const filename of selectedSuggestions) {
		if (filename.length === 0) continue;
		const firstCode = filename.charCodeAt(0);
		let paths = pathsByFirstCode.get(firstCode);
		if (paths === undefined) {
			paths = [];
			pathsByFirstCode.set(firstCode, paths);
		}
		paths[paths.length] = {
			filename,
			normalizedPath: normalizeMentionPath(filename),
		};
	}
	return pathsByFirstCode;
}

function replaceMultipleSelectedMentions(
	input: string,
	firstAtIndex: number,
	mentions: SelectedMentionPathIndex,
): string {
	let parts: string[] | undefined;
	let copiedUntil = 0;
	for (let index = firstAtIndex; index < input.length; index += 1) {
		if (input.charCodeAt(index) !== 64) continue;
		if (!isMentionStartBoundary(input, index)) continue;

		const match = findSelectedMention(input, index + 1, mentions);
		if (match === null) continue;

		parts ??= [];
		parts[parts.length] = input.slice(copiedUntil, index);
		parts[parts.length] = match.normalizedPath;
		copiedUntil = match.filenameEnd;
		index = match.filenameEnd - 1;
	}

	if (parts === undefined) return input;
	parts[parts.length] = input.slice(copiedUntil);
	return parts.join("");
}

function findSelectedMention(
	input: string,
	filenameStart: number,
	mentionsByFirstCode: SelectedMentionPathIndex,
): { filenameEnd: number; normalizedPath: string } | null {
	const mentions = mentionsByFirstCode.get(input.charCodeAt(filenameStart));
	if (mentions === undefined) return null;
	for (const { filename, normalizedPath } of mentions) {
		const filenameEnd = filenameStart + filename.length;
		if (
			input.startsWith(filename, filenameStart) &&
			isMentionEndBoundary(input, filenameEnd)
		) {
			return { filenameEnd, normalizedPath };
		}
	}
	return null;
}

function replaceSingleSelectedMention(
	input: string,
	firstAtIndex: number,
	filename: string,
	normalizedPath: string,
): string {
	let parts: string[] | undefined;
	let copiedUntil = 0;
	const filenameLength = filename.length;
	for (let index = firstAtIndex; index < input.length; index += 1) {
		if (input.charCodeAt(index) !== 64) continue;
		const filenameEnd = index + 1 + filenameLength;
		if (!isSelectedMentionAt(input, index, filename, filenameEnd)) continue;
		parts ??= [];
		parts[parts.length] = input.slice(copiedUntil, index);
		parts[parts.length] = normalizedPath;
		copiedUntil = filenameEnd;
		index = filenameEnd - 1;
	}

	if (parts === undefined) return input;
	parts[parts.length] = input.slice(copiedUntil);
	return parts.join("");
}

function hasSelectedMention(
	input: string,
	firstAtIndex: number,
	filename: string,
): boolean {
	if (filename.length === 0) return false;
	const filenameLength = filename.length;
	for (let index = firstAtIndex; index < input.length; index += 1) {
		if (input.charCodeAt(index) !== 64) continue;
		const filenameEnd = index + 1 + filenameLength;
		if (isSelectedMentionAt(input, index, filename, filenameEnd)) {
			return true;
		}
	}
	return false;
}

function isSelectedMentionAt(
	input: string,
	atIndex: number,
	filename: string,
	filenameEnd: number,
): boolean {
	return (
		isMentionStartBoundary(input, atIndex) &&
		input.startsWith(filename, atIndex + 1) &&
		isMentionEndBoundary(input, filenameEnd)
	);
}

function normalizeMentionPath(filename: string): string {
	return filename.startsWith("/") ||
		filename.startsWith("./") ||
		filename.startsWith("../")
		? filename
		: `./${filename}`;
}

function isMentionStartBoundary(input: string, atIndex: number): boolean {
	if (atIndex === 0) return true;
	const previousCode = input.charCodeAt(atIndex - 1);
	return previousCode !== 64 && !isAsciiWordCode(previousCode);
}

function isMentionEndBoundary(input: string, endIndex: number): boolean {
	if (endIndex >= input.length) return true;
	const nextCode = input.charCodeAt(endIndex);
	return (
		nextCode !== 45 &&
		nextCode !== 46 &&
		nextCode !== 47 &&
		!isAsciiWordCode(nextCode)
	);
}

function isAsciiWordCode(code: number): boolean {
	return (
		(code >= 48 && code <= 57) ||
		(code >= 65 && code <= 90) ||
		code === 95 ||
		(code >= 97 && code <= 122)
	);
}
