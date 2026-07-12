import { Box, Text } from "ink";
import { marked, type Token, type Tokens } from "marked";
import React from "react";
import { useTerminalSize } from "../layout/viewport.tsx";
import { HighlightedCode } from "./highlight.tsx";
import { normalizeRenderedLineBreaks } from "./lines.ts";
import {
	isMarkedToken,
	renderTokenAsPlaintext,
	renderTokensAsPlaintext,
} from "./plaintext.ts";
import { TableRenderer } from "./table.tsx";

type MarkdownRenderModel =
	| { kind: "plain"; text: string }
	| { kind: "tokens"; nodes: React.ReactNode[] };

export function Markdown({ markdown }: { markdown: string }) {
	const model = React.useMemo<MarkdownRenderModel>(() => {
		if (isPlainMarkdownFastPath(markdown)) {
			return { kind: "plain", text: normalizeRenderedLineBreaks(markdown) };
		}
		return { kind: "tokens", nodes: renderTokenNodes(marked.lexer(markdown)) };
	}, [markdown]);

	return (
		<Box flexDirection="column">
			{model.kind === "plain" ? <Text>{model.text}</Text> : model.nodes}
		</Box>
	);
}

export function isPlainMarkdownFastPath(markdown: string): boolean {
	const state = {
		lineStart: true,
		leadingSpaces: 0,
		hasContent: false,
		skipNextLf: false,
	};
	for (let index = 0; index < markdown.length; index += 1) {
		if (state.skipNextLf) {
			state.skipNextLf = false;
			continue;
		}
		if (!scanPlainMarkdownCharacter(markdown, index, state)) return false;
	}
	return state.hasContent || markdown.length === 0;
}

type PlainMarkdownScanState = {
	lineStart: boolean;
	leadingSpaces: number;
	hasContent: boolean;
	skipNextLf: boolean;
};

function scanPlainMarkdownCharacter(
	markdown: string,
	index: number,
	state: PlainMarkdownScanState,
): boolean {
	const code = markdown.charCodeAt(index);
	if (isRenderedLineBreak(code)) {
		state.lineStart = true;
		state.leadingSpaces = 0;
		state.skipNextLf = code === 13 && markdown.charCodeAt(index + 1) === 10;
		return true;
	}
	if (state.lineStart && isIndentedCodeStart(code, state)) return false;
	if (state.lineStart && code === 32) return true;
	if (state.lineStart && isMarkdownLineStart(markdown, index)) return false;
	state.lineStart = false;
	state.hasContent = true;
	return !isMarkdownInlineSyntax(code);
}

function isRenderedLineBreak(code: number): boolean {
	return code === 10 || code === 13;
}

function isIndentedCodeStart(
	code: number,
	state: PlainMarkdownScanState,
): boolean {
	if (code === 9) return true;
	if (code !== 32) return false;
	state.leadingSpaces += 1;
	return state.leadingSpaces >= 4;
}

function isMarkdownLineStart(markdown: string, index: number): boolean {
	const code = markdown.charCodeAt(index);
	if (code === 35 || code === 62 || code === 43 || code === 45) return true;
	if (code < 48 || code > 57) return false;
	let cursor = index + 1;
	while (cursor < markdown.length) {
		const nextCode = markdown.charCodeAt(cursor);
		if (nextCode < 48 || nextCode > 57) break;
		cursor += 1;
	}
	return markdown.charCodeAt(cursor) === 46;
}

function isMarkdownInlineSyntax(code: number): boolean {
	return (
		code === 33 ||
		code === 42 ||
		code === 60 ||
		code === 91 ||
		code === 92 ||
		code === 95 ||
		code === 96 ||
		code === 124 ||
		code === 126
	);
}

function renderChildren(tokens: Token[]): React.ReactNode {
	return renderTokenNodes(tokens);
}

function renderTokenNodes(tokens: readonly Token[]): React.ReactNode[] {
	const nodes: React.ReactNode[] = [];
	let writeIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === undefined) continue;
		nodes[writeIndex] = <TokenRenderer key={index} token={token} />;
		writeIndex += 1;
	}
	return nodes;
}

function TokenRenderer({ token }: { token: Token }): React.ReactNode {
	if (!isMarkedToken(token)) {
		return <Text>{renderTokenAsPlaintext(token)}</Text>;
	}
	const Renderer = MARKDOWN_TOKEN_RENDERERS[token.type];
	return Renderer === undefined ? (
		<Text>{renderTokenAsPlaintext(token)}</Text>
	) : (
		Renderer(token as never)
	);
}

function BlockquoteRenderer({ token }: { token: Tokens.Blockquote }) {
	return (
		<Box paddingLeft={2}>
			<Text color="gray">│ </Text>
			<Text italic={true}>{renderTokensAsPlaintext(token.tokens)}</Text>
		</Box>
	);
}

function BrRenderer() {
	return <Text>{"\n"}</Text>;
}

function CodeRenderer({ token }: { token: Tokens.Code }) {
	if (token.lang || token.codeBlockStyle !== "indented") {
		const langTag = token.lang
			? `┌─ ${token.lang} ${"─".repeat(Math.max(0, 40 - token.lang.length))}`
			: `┌${"─".repeat(42)}`;
		const footer = `└${"─".repeat(42)}`;

		return (
			<Box flexDirection="column" marginBottom={1}>
				<Text color="gray">{langTag}</Text>
				<Box paddingLeft={2} flexDirection="column">
					<HighlightedCode code={token.text} language={token.lang} />
				</Box>
				<Text color="gray">{footer}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginBottom={1} paddingLeft={2}>
			<HighlightedCode code={token.text} language={token.lang} />
		</Box>
	);
}

function CodespanRenderer({ token }: { token: Tokens.Codespan }) {
	return <Text inverse={true}>{token.text}</Text>;
}

function DefRenderer() {
	// Don't render definition links which are usually referenced elsewhere.
	return null;
}

function DelRenderer({ token }: { token: Tokens.Del }) {
	return (
		<Text strikethrough={true} dimColor={true}>
			{renderChildren(token.tokens)}
		</Text>
	);
}

function EmRenderer({ token }: { token: Tokens.Em }) {
	return <Text italic={true}>{renderChildren(token.tokens)}</Text>;
}

function EscapeRenderer({ token }: { token: Tokens.Escape }) {
	return <Text>{token.text}</Text>;
}

function HeadingRenderer({ token }: { token: Tokens.Heading }) {
	const indent = Math.max(0, token.depth - 1) * 2; // Convert to padding units

	const colors = ["magenta", "blue", "cyan", "green", "yellow", "red"] as const;

	const color = colors[Math.min(token.depth - 1, colors.length - 1)];
	const marker = token.depth === 1 ? "█" : token.depth === 2 ? "▆" : "▉";

	return (
		<Box marginTop={1} marginBottom={1} paddingLeft={indent}>
			<Text color={color} bold={true}>
				{marker} {renderChildren(token.tokens)}
			</Text>
		</Box>
	);
}

function HrRenderer() {
	const terminalSize = useTerminalSize();
	const width = Math.min(terminalSize.width, 80);
	return (
		<Box marginTop={1} marginBottom={1}>
			<Text color="gray">{"─".repeat(width)}</Text>
		</Box>
	);
}

function HtmlRenderer({ token }: { token: Tokens.HTML | Tokens.Tag }) {
	return <Text>{token.text}</Text>;
}

function ImageRenderer({ token }: { token: Tokens.Image }) {
	return <Text color="yellow">[Image: {token.text}]</Text>;
}

function LinkRenderer({ token }: { token: Tokens.Link }) {
	return (
		<Text color="blue">
			{renderChildren(token.tokens)} ({token.href})
		</Text>
	);
}

function ListRenderer({ token }: { token: Tokens.List }) {
	return (
		<Box flexDirection="column" paddingLeft={0} marginBottom={1}>
			{renderListItems(token)}
		</Box>
	);
}

function renderListItems(token: Tokens.List): React.ReactNode[] {
	const items: React.ReactNode[] = [];
	const start = typeof token.start === "number" ? token.start : 1;
	let writeIndex = 0;
	for (let index = 0; index < token.items.length; index += 1) {
		const item = token.items[index];
		if (item === undefined) continue;
		items[writeIndex] = (
			<Box key={index} flexDirection="row">
				<Text color="cyan">{token.ordered ? `${start + index}. ` : "• "}</Text>
				<ListItemRenderer token={item} />
			</Box>
		);
		writeIndex += 1;
	}
	return items;
}

function ListItemRenderer({ token }: { token: Tokens.ListItem }) {
	if (token.task && typeof token.checked === "boolean") {
		// For task items, render checkbox and content inline
		return (
			<Box flexDirection="column" flexGrow={1}>
				<Box flexDirection="row">
					<Text color={token.checked ? "green" : "gray"}>
						{token.checked ? "[✓]" : "[ ]"}{" "}
					</Text>
					<Box flexDirection="column" flexGrow={1}>
						{renderListItemChildren(token.tokens, true)}
					</Box>
				</Box>
			</Box>
		);
	}

	// For regular list items
	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box flexDirection="column">
				{renderListItemChildren(token.tokens, false)}
			</Box>
		</Box>
	);
}

function renderListItemChildren(
	tokens: Token[],
	skipCheckbox: boolean,
): React.ReactNode[] {
	const children: React.ReactNode[] = [];
	let writeIndex = 0;
	for (let index = 0; index < tokens.length; index += 1) {
		const childToken = tokens[index];
		if (skipCheckbox && childToken.type === "checkbox") continue;
		children[writeIndex] = (
			<Box key={index} paddingLeft={listChildPaddingLeft(childToken)}>
				<TokenRenderer token={childToken} />
			</Box>
		);
		writeIndex += 1;
	}
	return children;
}

function listChildPaddingLeft(token: Token): number {
	return token.type === "list" ||
		token.type === "code" ||
		token.type === "blockquote"
		? 1
		: 0;
}

function ParagraphRenderer({ token }: { token: Tokens.Paragraph }) {
	return (
		<Box marginBottom={1}>
			<Text>{renderChildren(token.tokens)}</Text>
		</Box>
	);
}

function StrongRenderer({ token }: { token: Tokens.Strong }) {
	return <Text bold={true}>{renderChildren(token.tokens)}</Text>;
}

function TextRenderer({ token }: { token: Tokens.Text }) {
	if (token.tokens) {
		return <Text>{renderChildren(token.tokens)}</Text>;
	}
	return <Text>{token.text}</Text>;
}

function SpaceRenderer() {
	return null;
}

type MarkdownTokenRenderer = (token: never) => React.ReactNode;

const MARKDOWN_TOKEN_RENDERERS: Partial<Record<string, MarkdownTokenRenderer>> =
	{
		blockquote: (token) => <BlockquoteRenderer token={token} />,
		br: () => <BrRenderer />,
		code: (token) => <CodeRenderer token={token} />,
		codespan: (token) => <CodespanRenderer token={token} />,
		def: () => <DefRenderer />,
		del: (token) => <DelRenderer token={token} />,
		em: (token) => <EmRenderer token={token} />,
		escape: (token) => <EscapeRenderer token={token} />,
		heading: (token) => <HeadingRenderer token={token} />,
		hr: () => <HrRenderer />,
		html: (token) => <HtmlRenderer token={token} />,
		image: (token) => <ImageRenderer token={token} />,
		link: (token) => <LinkRenderer token={token} />,
		list: (token) => <ListRenderer token={token} />,
		list_item: (token) => <ListItemRenderer token={token} />,
		paragraph: (token) => <ParagraphRenderer token={token} />,
		strong: (token) => <StrongRenderer token={token} />,
		table: (token) => <TableRenderer token={token} />,
		text: (token) => <TextRenderer token={token} />,
		space: () => <SpaceRenderer />,
	};
