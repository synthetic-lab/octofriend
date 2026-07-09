import type { MarkedToken, Token } from "marked";
import {
	isBrToken,
	isCodespanToken,
	isDelToken,
	isEmToken,
	isImageToken,
	isLinkToken,
	isStrongToken,
	isTextToken,
} from "./tokens";

export function renderTokensAsPlaintext(tokens: Token[]): string {
	if (tokens.length === 0) return "";
	if (tokens.length === 1) {
		const token = tokens[0];
		return token === undefined ? "" : renderTokenAsPlaintext(token);
	}
	const parts = new Array<string>(tokens.length);
	let writeIndex = 0;
	let index = 0;
	while (index < tokens.length) {
		const token = tokens[index];
		index += 1;
		if (token === undefined) continue;
		parts[writeIndex] = renderTokenAsPlaintext(token);
		writeIndex += 1;
	}
	if (writeIndex === 0) return "";
	if (writeIndex === 1) return parts[0] ?? "";
	if (writeIndex < parts.length) parts.length = writeIndex;
	return parts.join("");
}

export function renderTokenAsPlaintext(token: Token): string {
	if (isTextToken(token)) return token.text;
	if (isLinkToken(token))
		return `${renderTokensAsPlaintext(token.tokens)} (${token.href})`;
	if (isImageToken(token)) return `[Image: ${token.text}]`;
	if (isStrongToken(token) || isEmToken(token) || isDelToken(token)) {
		return renderTokensAsPlaintext(token.tokens);
	}
	if (isCodespanToken(token)) return token.text;
	if (isBrToken(token)) return "\n";
	if ("tokens" in token && Array.isArray(token.tokens)) {
		return renderTokensAsPlaintext(token.tokens);
	}
	if ("text" in token) return token.text;
	return "";
}

/**
 * Marked provides a `Tokens.Generic` interface that accepts any string for `type`, which breaks
 * type narrowing for `Token`. We check that the token is not generic (ie. a `MarkedToken`) before
 * filtering for token types to preserve type narrowing.
 * https://github.com/markedjs/marked/issues/2938
 */
const MARKED_TOKEN_TYPES: Record<string, true> = {
	blockquote: true,
	br: true,
	code: true,
	codespan: true,
	def: true,
	del: true,
	em: true,
	escape: true,
	heading: true,
	hr: true,
	html: true,
	image: true,
	link: true,
	list: true,
	list_item: true,
	paragraph: true,
	space: true,
	strong: true,
	table: true,
	text: true,
};

export function isMarkedToken(token: Token): token is MarkedToken {
	return MARKED_TOKEN_TYPES[token.type] === true;
}
