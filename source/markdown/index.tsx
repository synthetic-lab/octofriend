import React from "react";
import { Box, Text } from "ink";
import { marked, MarkedToken, Token, Tokens } from "marked";
import stringWidth from "string-width";
import { isImageToken, isLinkToken, isTextToken, isStrongToken, isEmToken, isDelToken, isCodespanToken } from "./types.ts";
import { highlightCode } from "./highlight-code.tsx";

export function renderMarkdown(markdown: string): React.ReactElement {
  const tokens = marked.lexer(markdown);
  return <Box flexDirection="column">
    { tokens.map((token, index) => <TokenRenderer key={index} token={token} />) }
  </Box>;
}

function TokenRenderer({ token }: { token: Token }): React.ReactElement {
  if (!isMarkedToken(token)) {
    throw new Error(`Unknown markdown token type: ${token.type}`);
  }

  switch (token.type) {
    case "blockquote":
      return <BlockquoteRenderer token={token} />;
    case "br":
      return <BrRenderer />;
    case "code":
      return <CodeRenderer token={token} />;
    case "codespan":
      return <CodespanRenderer token={token} />;
    case "def":
      return <DefRenderer token={token} />;
    case "del":
      return <DelRenderer token={token} />;
    case "em":
      return <EmRenderer token={token} />;
    case "escape":
      return <EscapeRenderer token={token} />;
    case "heading":
      return <HeadingRenderer token={token} />;
    case "hr":
      return <HrRenderer />;
    case "html":
      return <HtmlRenderer token={token} />;
    case "image":
      return <ImageRenderer token={token} />;
    case "link":
      return <LinkRenderer token={token} />;
    case "list":
      return <ListRenderer token={token} />;
    case "list_item":
      return <ListItemRenderer token={token} />;
    case "paragraph":
      return <ParagraphRenderer token={token} />;
    case "strong":
      return <StrongRenderer token={token} />;
    case "table":
      return <TableRenderer token={token} />;
    case "text":
      return <TextRenderer token={token} />;
    case "space":
      return <SpaceRenderer />;
  }
}


function BlockquoteRenderer({ token }: { token: Tokens.Blockquote }) {
  return <Box paddingLeft={2}>
    <Text color="gray">│ </Text>
    <Text italic>
      {renderTokensAsPlaintext(token.tokens)}
    </Text>
  </Box>
}

function BrRenderer() {
  return <Text>{'\n'}</Text>;
}

function CodeRenderer({ token }: { token: Tokens.Code }) {
  const highlightedLines = highlightCode(token.text, token.lang || undefined);

  if (token.lang || token.codeBlockStyle !== "indented") {
    const langTag = token.lang ? `┌─ ${token.lang} ` + '─'.repeat(Math.max(0, 40 - token.lang.length)) : '┌' + '─'.repeat(42);
    const footer = '└' + '─'.repeat(42);

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">{langTag}</Text>
        <Box paddingLeft={2} flexDirection="column">
          {highlightedLines.map((line, index) => (
            <Box key={index}>{line}</Box>
          ))}
        </Box>
        <Text color="gray">{footer}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      {highlightedLines.map((line, index) => (
        <Box key={index}>{line}</Box>
      ))}
    </Box>
  );
}

function CodespanRenderer({ token }: { token: Tokens.Codespan }) {
  return <Text inverse> {token.text} </Text>;
}

function DefRenderer({ token }: { token: Tokens.Def }) {
  // Don't render definition links which are usually referenced elsewhere.
  return <></>;
}

function DelRenderer({ token }: { token: Tokens.Del }) {
  return <Text strikethrough dimColor>{renderTokensAsPlaintext(token.tokens)}</Text>;
}

function EmRenderer({ token }: { token: Tokens.Em }) {
  return <Text italic>{renderTokensAsPlaintext(token.tokens)}</Text>;
}

function EscapeRenderer({ token }: { token: Tokens.Escape }) {
  return <Text>{token.text}</Text>;
}

function HeadingRenderer({ token }: { token: Tokens.Heading }) {
  const indent = Math.max(0, token.depth - 1) * 2; // Convert to padding units

  const colors = [
    "magenta",
    "blue",
    "cyan",
    "green",
    "yellow",
    "red"
  ] as const;

  const color = colors[Math.min(token.depth - 1, colors.length - 1)];
  const marker = token.depth === 1 ? "█" : token.depth === 2 ? "▆" : "▉";

  return (
    <Box marginTop={1} marginBottom={1} paddingLeft={indent}>
      <Text color={color} bold>
        {marker} {renderTokensAsPlaintext(token.tokens)}
      </Text>
    </Box>
  );
}

function HrRenderer() {
  const width = Math.min(process.stdout.columns || 80, 80);
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
  // For now, combine link text and URL in a single text element
  const linkText = renderTokensAsPlaintext(token.tokens);
  return <Text color="blue">{linkText} ({token.href})</Text>;
}

function ListRenderer({ token }: { token: Tokens.List }) {
  return (
    <Box flexDirection="column" paddingLeft={0} marginBottom={1}>
      {token.items.map((item, index) => (
        <Box key={index} flexDirection="row">
          <Text color="cyan">
            {token.ordered
              ? `${(typeof token.start === "number" ? token.start : 1) + index}. `
              : "• "
            }
          </Text>
          <ListItemRenderer token={item} />
        </Box>
      ))}
    </Box>
  );
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
            {token.tokens.map((childToken, index) => (
              <Box key={index} paddingLeft={childToken.type === 'list' || childToken.type === 'code' || childToken.type === 'blockquote' ? 1 : 0}>
                <TokenRenderer token={childToken} />
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    );
  }

  // For regular list items
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column">
        {token.tokens.map((childToken, index) => (
          <Box key={index} paddingLeft={childToken.type === 'list' || childToken.type === 'code' || childToken.type === 'blockquote' ? 1 : 0}>
            <TokenRenderer token={childToken} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function ParagraphRenderer({ token }: { token: Tokens.Paragraph }) {
  return <Box marginBottom={1}><Text>{renderTokensAsPlaintext(token.tokens)}</Text></Box>;
}

function StrongRenderer({ token }: { token: Tokens.Strong }) {
  return <Text bold>{renderTokensAsPlaintext(token.tokens)}</Text>;
}

function TableRenderer({ token }: { token: Tokens.Table }) {
  // Calculate column widths by measuring display width of all content
  const allRows = [token.header, ...token.rows];
  const columnWidths = token.header.map((_, colIndex) => {
    const maxWidth = Math.max(
      ...allRows.map(row => {
        const cell = row[colIndex];
        if (cell) {
          const cellText = renderTokensAsPlaintext(cell.tokens);
          return stringWidth(cellText);
        }
        return 0;
      })
    );
    return Math.max(maxWidth, 3); // Minimum width of 3
  });

  const separator = "├" + columnWidths.map(w => "─".repeat(w + 2)).join("┼") + "┤";

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <TableRowRenderer cells={token.header} columnWidths={columnWidths} isHeader={true} />
      <Text color="gray">{separator}</Text>
      {token.rows.map((row, index) => (
        <TableRowRenderer key={index} cells={row} columnWidths={columnWidths} isHeader={false} />
      ))}
    </Box>
  );
}

function TableRowRenderer({ cells, columnWidths, isHeader }: {
  cells: Tokens.TableCell[];
  columnWidths: number[];
  isHeader: boolean;
}) {
  return (
    <Box flexDirection="row">
      <Text color="gray">│ </Text>
      {cells.map((cell, index) => {
        const cellText = renderTokensAsPlaintext(cell.tokens);
        const paddedText = cellText.padEnd(columnWidths[index]);
        return (
          <React.Fragment key={index}>
            <Text color={isHeader ? "cyan" : "white"} bold={isHeader}>
              {paddedText}
            </Text>
            <Text color="gray"> │ </Text>
          </React.Fragment>
        );
      })}
    </Box>
  );
}

function TextRenderer({ token }: { token: Tokens.Text }) {
  if (token.tokens) {
    return <Text>{renderTokensAsPlaintext(token.tokens)}</Text>;
  }
  return <Text>{token.text}</Text>;
}

function SpaceRenderer() {
  return <></>;
}

function GenericRenderer({ token }: { token: Tokens.Generic }) {
  if (token.tokens) {
    return <Text>{renderTokensAsPlaintext(token.tokens)}</Text>;
  }
  return <Text>{token.raw || ""}</Text>;
}

function renderTokensAsPlaintext(tokens: Token[]): string {
  return tokens.map(token => {
    if (isTextToken(token)) {
      return token.text;
    }
    if (isLinkToken(token)) {
      return `${renderTokensAsPlaintext(token.tokens)} (${token.href})`;
    }
    if (isImageToken(token)) {
      return `[Image: ${token.text}]`;
    }
    if (isStrongToken(token)) {
      return renderTokensAsPlaintext(token.tokens);
    }
    if (isEmToken(token)) {
      return renderTokensAsPlaintext(token.tokens);
    }
    if (isDelToken(token)) {
      return renderTokensAsPlaintext(token.tokens);
    }
    if (isCodespanToken(token)) {
      return ` ${token.text} `;
    }
    if ('tokens' in token && Array.isArray(token.tokens)) {
      return renderTokensAsPlaintext(token.tokens);
    }
    if ('text' in token) {
      return token.text;
    }
    return '';
  }).join('');
}

const MARKED_TOKEN_TYPES = [
  "blockquote",
  "br",
  "code",
  "codespan",
  "def",
  "del",
  "em",
  "escape",
  "heading",
  "hr",
  "html",
  "image",
  "link",
  "list",
  "list_item",
  "paragraph",
  "space",
  "strong",
  "table",
  "text",
];

/**
 * Marked provides a `Tokens.Generic` interface that accepts any string for `type`, which breaks
 * type narrowing for `Token`. We check that the token is not generic (ie. a `MarkedToken`) before
 * filtering for token types to preserve type narrowing.
 * https://github.com/markedjs/marked/issues/2938
 */
function isMarkedToken(token: Token): token is MarkedToken {
  return MARKED_TOKEN_TYPES.includes(token.type);
}
