import { nextTextBoundary, previousTextBoundary } from "./boundaries.ts";

export function textGraphemeAt(text: string, position: number): string {
	return text.slice(position, nextTextBoundary(text, position));
}

export function previousTextGrapheme(text: string, position: number): string {
	const previous = previousTextBoundary(text, position);
	return text.slice(previous, position);
}
