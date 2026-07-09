import chalk from "chalk";
import { nextTextBoundary, previousTextBoundary } from "./boundaries";

export type CursorTextOptions = {
	wrapped: string;
	wrappedCursorPosition: number;
	placeholder: string;
	showCursor: boolean;
	focus: boolean;
	value: string;
};

export function renderCursorText(options: CursorTextOptions): string {
	const shouldRenderCursor = options.showCursor && options.focus;
	if (options.value.length === 0 && options.placeholder) {
		return shouldRenderCursor
			? renderPlaceholderWithCursor(options.placeholder)
			: chalk.grey(options.placeholder);
	}
	return shouldRenderCursor
		? renderValueWithCursor(options.wrapped, options.wrappedCursorPosition)
		: options.wrapped || "";
}

function renderPlaceholderWithCursor(placeholder: string): string {
	if (placeholder.length === 0) return chalk.inverse(" ");
	const cursorEnd = nextTextBoundary(placeholder, 0);
	return (
		chalk.inverse(placeholder.slice(0, cursorEnd)) +
		chalk.grey(placeholder.slice(cursorEnd))
	);
}

function renderValueWithCursor(
	wrapped: string,
	wrappedCursorPosition: number,
): string {
	if (wrapped.length === 0) return chalk.inverse(" ");
	if (wrappedCursorPosition < 0 || wrappedCursorPosition > wrapped.length) {
		return wrapped;
	}
	const normalizedCursorPosition = normalizeCursorPosition(
		wrapped,
		wrappedCursorPosition,
	);
	if (normalizedCursorPosition === wrapped.length) {
		return `${wrapped}${chalk.inverse(" ")}`;
	}
	const firstLineBreakIndex = lineBreakIndex(wrapped, 0);
	if (firstLineBreakIndex === -1) {
		return renderCursorLine(wrapped, 0, 0, normalizedCursorPosition);
	}
	const lineStart = cursorLineStart(wrapped, normalizedCursorPosition);
	const nextLineBreakIndex = lineBreakIndex(wrapped, lineStart);
	const lineEnd =
		nextLineBreakIndex === -1 ? wrapped.length : nextLineBreakIndex;
	if (normalizedCursorPosition === lineEnd && isLineBreakAt(wrapped, lineEnd)) {
		const breakEnd = lineBreakEnd(wrapped, lineEnd);
		return (
			wrapped.slice(0, lineEnd) +
			chalk.inverse(wrapped.slice(lineEnd, breakEnd)) +
			wrapped.slice(breakEnd)
		);
	}
	return renderCursorLineInText(
		wrapped,
		lineStart,
		lineEnd,
		lineStart === 0 ? 0 : 1,
		normalizedCursorPosition,
	);
}

function normalizeCursorPositionForLineBreak(
	value: string,
	index: number,
): number {
	return index > 0 &&
		index < value.length &&
		value.charCodeAt(index - 1) === 13 &&
		value.charCodeAt(index) === 10
		? index - 1
		: index;
}

function normalizeCursorPosition(value: string, index: number): number {
	const lineBreakPosition = normalizeCursorPositionForLineBreak(value, index);
	if (lineBreakPosition !== index) return lineBreakPosition;
	if (index <= 0 || index >= value.length) return index;

	const previousBoundary = previousTextBoundary(value, index);
	const nextBoundary = nextTextBoundary(value, previousBoundary);
	return nextBoundary > index ? previousBoundary : index;
}

function isLineBreakAt(value: string, index: number): boolean {
	const code = value.charCodeAt(index);
	return code === 10 || code === 13;
}

function lineBreakEnd(value: string, index: number): number {
	if (value.charCodeAt(index) === 13 && value.charCodeAt(index + 1) === 10) {
		return index + 2;
	}
	return index + 1;
}

function lineBreakIndex(value: string, start: number): number {
	const lfIndex = value.indexOf("\n", start);
	const crIndex = value.indexOf("\r", start);
	if (lfIndex === -1) return crIndex;
	if (crIndex === -1) return lfIndex;
	return lfIndex < crIndex ? lfIndex : crIndex;
}

function cursorLineStart(
	wrapped: string,
	wrappedCursorPosition: number,
): number {
	let beforeCursor = wrappedCursorPosition - 1;
	if (beforeCursor < 0) beforeCursor = 0;
	while (beforeCursor >= 0) {
		const code = wrapped.charCodeAt(beforeCursor);
		if (code === 10 || code === 13) return beforeCursor + 1;
		beforeCursor -= 1;
	}
	return 0;
}

function renderCursorLine(
	line: string,
	lineIndex: number,
	startPosition: number,
	wrappedCursorPosition: number,
): string {
	const endPosition = startPosition + line.length;
	if (
		wrappedCursorPosition < startPosition ||
		wrappedCursorPosition > endPosition
	) {
		return line;
	}
	if (wrappedCursorPosition < endPosition) {
		const lineCursorPosition = wrappedCursorPosition - startPosition;
		const cursorEnd = nextTextBoundary(line, lineCursorPosition);
		return (
			line.slice(0, lineCursorPosition) +
			chalk.inverse(line.slice(lineCursorPosition, cursorEnd)) +
			line.slice(cursorEnd)
		);
	}
	if (
		shouldRenderTrailingCursor(
			line.length,
			lineIndex,
			endPosition,
			wrappedCursorPosition,
		)
	) {
		return `${line}${chalk.inverse(" ")}`;
	}
	return line;
}

function renderCursorLineInText(
	text: string,
	lineStart: number,
	lineEnd: number,
	lineIndex: number,
	wrappedCursorPosition: number,
): string {
	if (wrappedCursorPosition < lineStart || wrappedCursorPosition > lineEnd) {
		return text;
	}
	if (wrappedCursorPosition < lineEnd) {
		const cursorEnd = nextTextBoundary(text, wrappedCursorPosition);
		return (
			text.slice(0, wrappedCursorPosition) +
			chalk.inverse(text.slice(wrappedCursorPosition, cursorEnd)) +
			text.slice(cursorEnd)
		);
	}
	if (
		shouldRenderTrailingCursor(
			lineEnd - lineStart,
			lineIndex,
			lineEnd,
			wrappedCursorPosition,
		)
	) {
		return `${text.slice(0, lineEnd)}${chalk.inverse(" ")}${text.slice(lineEnd)}`;
	}
	return text;
}

function shouldRenderTrailingCursor(
	lineLength: number,
	lineIndex: number,
	position: number,
	wrappedCursorPosition: number,
): boolean {
	return (
		position === wrappedCursorPosition &&
		!(lineIndex === 0 && lineLength === 0 && wrappedCursorPosition === 0)
	);
}
