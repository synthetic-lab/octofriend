import type { XMLEventHandlers } from "./types";

const ParserState = {
	TEXT: "text",
	TAG_START: "tagStart",
	CLOSING_TAG: "closingTag",
	OPENING_TAG: "openingTag",
} as const;

type ParserState = (typeof ParserState)[keyof typeof ParserState];

/**
 * A simple streaming XML parser that handles partial chunks
 * and emits contiguous text runs instead of one event per code point
 */
export class StreamingXMLParser {
	#state: ParserState = ParserState.TEXT;

	#buffer = "";
	#currentTag = "";
	#pendingHighSurrogate = "";

	#attributes: Record<string, string> = {};
	#handlers: Partial<XMLEventHandlers>;
	#whitelist: string[] | null;

	#closed = false;

	constructor({
		handlers,
		whitelist,
	}: {
		handlers: Partial<XMLEventHandlers>;
		whitelist?: string[];
	}) {
		this.#handlers = handlers;
		this.#whitelist = whitelist || null;
	}

	write(chunk: string): void {
		if (this.#closed) return;

		const text = this.#prepareChunk(chunk);
		if (!text) return;
		let index = 0;
		while (index < text.length) {
			if (this.#state === ParserState.TEXT) {
				const tagStart = text.indexOf("<", index);
				if (tagStart === -1) {
					this.#emitText(text.slice(index));
					break;
				}
				if (tagStart > index) {
					this.#emitText(text.slice(index, tagStart));
					index = tagStart;
				}
			}

			index = this.#processChunkChar(text, index);
		}
	}

	#prepareChunk(chunk: string): string {
		let text = chunk;
		if (!text) return "";
		if (this.#pendingHighSurrogate) {
			text = this.#pendingHighSurrogate + text;
			this.#pendingHighSurrogate = "";
		}
		const lastCodeUnit = text.charCodeAt(text.length - 1);
		if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
			this.#pendingHighSurrogate = text[text.length - 1] ?? "";
			return text.slice(0, -1);
		}
		return text;
	}

	#processChunkChar(chunk: string, index: number): number {
		const codeUnit = chunk.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			if (index + 1 >= chunk.length) {
				this.#pendingHighSurrogate = chunk[index] ?? "";
				return chunk.length;
			}

			const nextCodeUnit = chunk.charCodeAt(index + 1);
			if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
				this.#processChar(chunk[index] ?? "");
				return index + 1;
			}

			const codePoint = chunk.codePointAt(index);
			if (codePoint === undefined) return chunk.length;
			this.#processChar(String.fromCodePoint(codePoint));
			return index + 2;
		}

		this.#processChar(chunk[index] ?? "");
		return index + 1;
	}

	#processChar(char: string): void {
		switch (this.#state) {
			case ParserState.TEXT:
				this.#processTextState(char);
				return;
			case ParserState.TAG_START:
				this.#processTagStartState(char);
				return;
			case ParserState.OPENING_TAG:
				this.#processOpeningTagState(char);
				return;
			case ParserState.CLOSING_TAG:
				this.#processClosingTagState(char);
				return;
			default:
				return;
		}
	}

	#processTextState(char: string): void {
		if (char === "<") {
			this.#buffer = char;
			this.#state = ParserState.TAG_START;
		} else {
			this.#emitText(char);
		}
	}

	#processTagStartState(char: string): void {
		this.#buffer += char;

		if (char === "/") {
			this.#state = ParserState.CLOSING_TAG;
			this.#currentTag = "";
			return;
		}

		if (isValidTagNameChar(char, true)) {
			this.#currentTag = char;

			if (this.#failWhitelistProgress("", char)) {
				this.#emitTextAndReset(this.#buffer);
				this.#currentTag = "";
				return;
			}

			this.#state = ParserState.OPENING_TAG;
			this.#attributes = {};
			return;
		}

		this.#emitTextAndReset(this.#buffer);
	}

	#failWhitelistProgress(tag: string, char: string) {
		if (!this.#whitelist) return false;
		const nextTag = tag + char;
		let index = 0;
		while (index < this.#whitelist.length) {
			if (this.#whitelist[index]?.startsWith(nextTag)) return false;
			index += 1;
		}
		return true;
	}

	#failWhitelist(tag: string) {
		if (!this.#whitelist) return false;
		let index = 0;
		while (index < this.#whitelist.length) {
			if (this.#whitelist[index] === tag) return false;
			index += 1;
		}
		return true;
	}

	#processOpeningTagState(char: string): void {
		this.#buffer += char;

		if (isValidTagNameChar(char, false)) {
			if (this.#failWhitelistProgress(this.#currentTag, char)) {
				this.#emitTextAndReset(this.#buffer);
				return;
			}
			this.#currentTag += char;
			return;
		}

		if (this.#failWhitelist(this.#currentTag)) {
			this.#emitTextAndReset(this.#buffer);
			return;
		}

		if (char === ">") {
			this.#emitOpenTag(this.#currentTag, this.#attributes);
			this.#buffer = "";
			this.#state = ParserState.TEXT;
			return;
		}

		if (char === "/" || isWhitespace(char)) return;

		this.#emitTextAndReset(this.#buffer);
	}

	#processClosingTagState(char: string): void {
		this.#buffer += char;

		if (isValidTagNameChar(char, true) || isValidTagNameChar(char, false)) {
			if (this.#failWhitelistProgress(this.#currentTag, char)) {
				this.#emitTextAndReset(this.#buffer);
				return;
			}

			this.#currentTag += char;
			return;
		}

		if (this.#failWhitelist(this.#currentTag)) {
			this.#emitTextAndReset(this.#buffer);
			return;
		}

		if (char === ">") {
			this.#emitCloseTag(this.#currentTag);

			this.#buffer = "";
			this.#state = ParserState.TEXT;
			return;
		}

		if (isWhitespace(char)) return;

		this.#emitTextAndReset(this.#buffer);
	}

	close(): void {
		if (this.#pendingHighSurrogate) {
			this.#processChar(this.#pendingHighSurrogate);
			this.#pendingHighSurrogate = "";
		}

		if (this.#buffer) {
			this.#emitText(this.#buffer);
			this.#buffer = "";
		}

		this.#closed = true;
	}

	#emitText(text: string): void {
		if (text && this.#handlers.onText) {
			this.#handlers.onText({
				type: "text",
				content: text,
			});
		}
	}

	#emitOpenTag(name: string, attributes: Record<string, string>): void {
		if (this.#handlers.onOpenTag) {
			const selfClosing = this.#buffer.trimEnd().endsWith("/>");
			this.#handlers.onOpenTag({
				type: "openTag",
				name,
				attributes,
			});

			if (selfClosing && this.#handlers.onCloseTag) {
				this.#handlers.onCloseTag({
					type: "closeTag",
					name,
				});
			}
		}
	}

	#emitCloseTag(name: string): void {
		if (this.#handlers.onCloseTag) {
			this.#handlers.onCloseTag({
				type: "closeTag",
				name,
			});
		}
	}

	#emitTextAndReset(content: string): void {
		this.#emitText(content);
		this.#buffer = "";
		this.#state = ParserState.TEXT;
	}
}

function isWhitespace(char: string): boolean {
	const code = char.charCodeAt(0);
	return code === 9 || code === 10 || code === 13 || code === 32;
}

function isValidTagNameChar(char: string, isFirst: boolean): boolean {
	const code = char.charCodeAt(0);
	const isAlpha = (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
	if (isAlpha || code === 58 || code === 95) return true;
	return !isFirst && ((code >= 48 && code <= 57) || code === 45 || code === 46);
}
