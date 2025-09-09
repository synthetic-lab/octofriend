import React from "react";
import { Box, Text } from "ink";
import { marked, MarkedToken, Token, Tokens } from "marked";
import stringWidth from "string-width";

export function renderMarkdown(markdown: string): React.ReactElement {
  const tokens = marked.lexer(markdown);
  return <MarkdownRenderer tokens={tokens} />;
}

function MarkdownRenderer({ tokens }: { tokens: Token[] }): React.ReactElement {
  return <Box flexDirection="column">
    { tokens.map((token, index) => <TokenRenderer key={index} token={token} />) }
  </Box>;
}

function TokenRenderer({ token }: { token: Token }): React.ReactElement {
  if (!isMarkedToken(token)) {
    return <GenericRenderer token={token} />;
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
    default:
      return <GenericRenderer token={token} />;
  }
}


function BlockquoteRenderer({ token }: { token: Tokens.Blockquote }) {
  return (
    <Box paddingLeft={2}>
      <Text color="gray">│ </Text>
      <Text italic>
        {renderTokensAsText(token.tokens)}
      </Text>
    </Box>
  );
}

function BrRenderer() {
  return <Text>{'\n'}</Text>;
}

function CodeRenderer({ token }: { token: Tokens.Code }) {
  const lines = token.text.split('\n');

  if (token.lang || token.codeBlockStyle !== "indented") {
    const langTag = token.lang ? `┌─ ${token.lang} ` + '─'.repeat(Math.max(0, 40 - token.lang.length)) : '┌' + '─'.repeat(42);
    const footer = '└' + '─'.repeat(42);

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color="gray">{langTag}</Text>
        <Box paddingLeft={2} flexDirection="column">
          {lines.map((line, index) => (
            <Text key={index} color="white">{line || ' '}</Text>
          ))}
        </Box>
        <Text color="gray">{footer}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1} paddingLeft={2}>
      {lines.map((line, index) => (
        <Text key={index} color="white">{line || ' '}</Text>
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
  return <Text strikethrough dimColor>{renderTokensAsText(token.tokens)}</Text>;
}

function EmRenderer({ token }: { token: Tokens.Em }) {
  return <Text italic>{renderTokensAsText(token.tokens)}</Text>;
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
        {marker} {renderTokensAsText(token.tokens)}
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
  const linkText = renderTokensAsText(token.tokens);
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
  return (
    <Box flexDirection="column" flexGrow={1}>
      {token.task && typeof token.checked === "boolean" && (
        <Text color={token.checked ? "green" : "gray"}>
          {token.checked ? "[✓]" : "[ ]"}{" "}
        </Text>
      )}
      <Box flexDirection="column" paddingLeft={token.task ? 0 : 0}>
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
  return <Box marginBottom={1}><Text>{renderTokensAsText(token.tokens)}</Text></Box>;
}

function StrongRenderer({ token }: { token: Tokens.Strong }) {
  return <Text bold>{renderTokensAsText(token.tokens)}</Text>;
}

function TableRenderer({ token }: { token: Tokens.Table }) {
  // Calculate column widths by measuring display width of all content
  const allRows = [token.header, ...token.rows];
  const columnWidths = token.header.map((_, colIndex) => {
    const maxWidth = Math.max(
      ...allRows.map(row => {
        const cell = row[colIndex];
        if (cell) {
          const cellText = renderTokensAsText(cell.tokens);
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
        const cellText = renderTokensAsText(cell.tokens);
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

function TableCellRenderer({ token }: { token: Tokens.TableCell }) {
  return <Text>{renderTokensAsText(token.tokens)}</Text>;
}

function TextRenderer({ token }: { token: Tokens.Text }) {
  if (token.tokens) {
    return <Text>{renderTokensAsText(token.tokens)}</Text>;
  }
  return <Text>{token.text}</Text>;
}

function SpaceRenderer() {
  return <></>;
}

function GenericRenderer({ token }: { token: Tokens.Generic }) {
  if (token.tokens) {
    return <Text>{renderTokensAsText(token.tokens)}</Text>;
  }
  return <Text>{token.raw || ""}</Text>;
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

function renderTokensAsText(tokens: Token[]): string {
  return tokens.map(token => {
    if (token.type === 'text') {
      return (token as Tokens.Text).text;
    }
    if (token.type === 'link') {
      const linkToken = token as Tokens.Link;
      return `${renderTokensAsText(linkToken.tokens)} (${linkToken.href})`;
    }
    if (token.type === 'image') {
      const imageToken = token as Tokens.Image;
      return `[Image: ${imageToken.text}]`;
    }
    if (token.type === 'strong') {
      const strongToken = token as Tokens.Strong;
      return renderTokensAsText(strongToken.tokens);
    }
    if (token.type === 'em') {
      const emToken = token as Tokens.Em;
      return renderTokensAsText(emToken.tokens);
    }
    if (token.type === 'del') {
      const delToken = token as Tokens.Del;
      return renderTokensAsText(delToken.tokens);
    }
    if (token.type === 'codespan') {
      const codespanToken = token as Tokens.Codespan;
      return ` ${codespanToken.text} `;
    }
    if ('tokens' in token && Array.isArray(token.tokens)) {
      return renderTokensAsText(token.tokens);
    }
    if ('text' in token) {
      return (token as any).text;
    }
    return '';
  }).join('');
}

/**
 * Marked provides a `Tokens.Generic` interface with a string type for extensions, which breaks
 * type narrowing for `Token`, so we check that the token is not generic (ie. a `MarkedToken`) here.
 * https://github.com/markedjs/marked/issues/2938
 */
function isMarkedToken(token: Token): token is MarkedToken {
  return MARKED_TOKEN_TYPES.includes(token.type);
}