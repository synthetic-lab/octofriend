import React from "react";
import { marked, MarkedToken, Token, Tokens } from "marked";
import stringWidth from "string-width";
import {
  isImageToken,
  isLinkToken,
  isTextToken,
  isStrongToken,
  isEmToken,
  isDelToken,
  isCodespanToken,
} from "./types.ts";
import { HighlightedCode } from "./highlight-code.tsx";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "../components/terminal-flex.tsx";
import {
  MARKDOWN_BLOCKQUOTE_BORDER_COLOR,
  MARKDOWN_CHECKED_TASK_COLOR,
  MARKDOWN_CODE_BLOCK_BORDER_COLOR,
  MARKDOWN_HEADING_COLORS,
  MARKDOWN_HORIZONTAL_RULE_COLOR,
  MARKDOWN_IMAGE_COLOR,
  MARKDOWN_INLINE_CODE_BACKGROUND_COLOR,
  MARKDOWN_INLINE_CODE_FOREGROUND_COLOR,
  MARKDOWN_LINK_COLOR,
  MARKDOWN_LIST_MARKER_COLOR,
  MARKDOWN_STRIKETHROUGH_COLOR,
  MARKDOWN_TABLE_BORDER_COLOR,
  MARKDOWN_TABLE_CELL_COLOR,
  MARKDOWN_TABLE_HEADER_COLOR,
  MARKDOWN_UNCHECKED_TASK_COLOR,
} from "../theme.ts";
export function Markdown({ markdown }: { markdown: string }) {
  const tokens = marked.lexer(markdown);
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
      }}
    >
      {tokens.map((token, index) => (
        <TokenRenderer key={index} token={token} />
      ))}
    </TerminalFlex>
  );
}
function renderChildren(tokens: Token[]): React.ReactNode {
  return tokens.map((token, index) => <TokenRenderer key={index} token={token} />);
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
  return (
    <TerminalFlex
      style={{
        paddingLeft: 2,
      }}
    >
      <Span
        style={{
          color: MARKDOWN_BLOCKQUOTE_BORDER_COLOR,
        }}
      >
        │{" "}
      </Span>
      <Span
        style={{
          fontStyle: "italic",
        }}
      >
        {renderTokensAsPlaintext(token.tokens)}
      </Span>
    </TerminalFlex>
  );
}
function BrRenderer() {
  return <Span>{"\n"}</Span>;
}
function CodeRenderer({ token }: { token: Tokens.Code }) {
  if (token.lang || token.codeBlockStyle !== "indented") {
    const langTag = token.lang
      ? `┌─ ${token.lang} ` + "─".repeat(Math.max(0, 40 - token.lang.length))
      : "┌" + "─".repeat(42);
    const footer = "└" + "─".repeat(42);
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
          marginBottom: 1,
        }}
      >
        <Span
          style={{
            color: MARKDOWN_CODE_BLOCK_BORDER_COLOR,
          }}
        >
          {langTag}
        </Span>
        <TerminalFlex
          style={{
            paddingLeft: 2,
            flexDirection: "column",
          }}
        >
          <HighlightedCode code={token.text} language={token.lang} />
        </TerminalFlex>
        <Span
          style={{
            color: MARKDOWN_CODE_BLOCK_BORDER_COLOR,
          }}
        >
          {footer}
        </Span>
      </TerminalFlex>
    );
  }
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        marginBottom: 1,
        paddingLeft: 2,
      }}
    >
      <HighlightedCode code={token.text} language={token.lang} />
    </TerminalFlex>
  );
}
function CodespanRenderer({ token }: { token: Tokens.Codespan }) {
  return (
    <Span
      style={{
        color: MARKDOWN_INLINE_CODE_FOREGROUND_COLOR,
        backgroundColor: MARKDOWN_INLINE_CODE_BACKGROUND_COLOR,
      }}
    >
      {token.text}
    </Span>
  );
}
function DefRenderer({ token }: { token: Tokens.Def }) {
  // Don't render definition links which are usually referenced elsewhere.
  return <></>;
}
function DelRenderer({ token }: { token: Tokens.Del }) {
  return (
    <Span
      style={{
        textDecoration: "line-through",
        color: MARKDOWN_STRIKETHROUGH_COLOR,
      }}
    >
      {renderChildren(token.tokens)}
    </Span>
  );
}
function EmRenderer({ token }: { token: Tokens.Em }) {
  return (
    <Span
      style={{
        fontStyle: "italic",
      }}
    >
      {renderChildren(token.tokens)}
    </Span>
  );
}
function EscapeRenderer({ token }: { token: Tokens.Escape }) {
  return <Span>{token.text}</Span>;
}
function HeadingRenderer({ token }: { token: Tokens.Heading }) {
  const indent = Math.max(0, token.depth - 1) * 2; // Convert to padding units

  const color =
    MARKDOWN_HEADING_COLORS[Math.min(token.depth - 1, MARKDOWN_HEADING_COLORS.length - 1)];
  const marker = "#".repeat(token.depth);
  return (
    <TerminalFlex
      style={{
        marginTop: 1,
        marginBottom: 1,
        paddingLeft: indent,
      }}
    >
      <Span
        style={{
          color,
          fontWeight: "bold",
        }}
      >
        {marker} {renderChildren(token.tokens)}
      </Span>
    </TerminalFlex>
  );
}
function HrRenderer() {
  const width = Math.min(process.stdout.columns || 80, 80);
  return (
    <TerminalFlex
      style={{
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <Span
        style={{
          color: MARKDOWN_HORIZONTAL_RULE_COLOR,
        }}
      >
        {"─".repeat(width)}
      </Span>
    </TerminalFlex>
  );
}
function HtmlRenderer({ token }: { token: Tokens.HTML | Tokens.Tag }) {
  return <Span>{token.text}</Span>;
}
function ImageRenderer({ token }: { token: Tokens.Image }) {
  return (
    <Span
      style={{
        color: MARKDOWN_IMAGE_COLOR,
      }}
    >
      [Image: {token.text}]
    </Span>
  );
}
function LinkRenderer({ token }: { token: Tokens.Link }) {
  // For now, combine link text and URL in a single text element
  const linkText = renderTokensAsPlaintext(token.tokens);
  return (
    <Span
      style={{
        color: MARKDOWN_LINK_COLOR,
      }}
    >
      {linkText} ({token.href}){renderChildren(token.tokens)} ({token.href})
    </Span>
  );
}
function ListRenderer({ token }: { token: Tokens.List }) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        paddingLeft: 0,
        marginBottom: 1,
      }}
    >
      {token.items.map((item, index) => (
        <TerminalFlex
          key={index}
          style={{
            flexDirection: "row",
          }}
        >
          <Span
            style={{
              color: MARKDOWN_LIST_MARKER_COLOR,
            }}
          >
            {token.ordered
              ? `${(typeof token.start === "number" ? token.start : 1) + index}. `
              : "• "}
          </Span>
          <ListItemRenderer token={item} />
        </TerminalFlex>
      ))}
    </TerminalFlex>
  );
}
function ListItemRenderer({ token }: { token: Tokens.ListItem }) {
  if (token.task && typeof token.checked === "boolean") {
    // For task items, render checkbox and content inline
    return (
      <TerminalFlex
        style={{
          flexDirection: "column",
          flexGrow: 1,
        }}
      >
        <TerminalFlex
          style={{
            flexDirection: "row",
          }}
        >
          <Span
            style={{
              color: token.checked ? MARKDOWN_CHECKED_TASK_COLOR : MARKDOWN_UNCHECKED_TASK_COLOR,
            }}
          >
            {token.checked ? "[✓]" : "[ ]"}{" "}
          </Span>
          <TerminalFlex
            style={{
              flexDirection: "column",
              flexGrow: 1,
            }}
          >
            {token.tokens.map((childToken, index) => (
              <TerminalFlex
                key={index}
                style={{
                  paddingLeft:
                    childToken.type === "list" ||
                    childToken.type === "code" ||
                    childToken.type === "blockquote"
                      ? 1
                      : 0,
                }}
              >
                <TokenRenderer token={childToken} />
              </TerminalFlex>
            ))}
          </TerminalFlex>
        </TerminalFlex>
      </TerminalFlex>
    );
  }

  // For regular list items
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        flexGrow: 1,
      }}
    >
      <TerminalFlex
        style={{
          flexDirection: "column",
        }}
      >
        {token.tokens.map((childToken, index) => (
          <TerminalFlex
            key={index}
            style={{
              paddingLeft:
                childToken.type === "list" ||
                childToken.type === "code" ||
                childToken.type === "blockquote"
                  ? 1
                  : 0,
            }}
          >
            <TokenRenderer token={childToken} />
          </TerminalFlex>
        ))}
      </TerminalFlex>
    </TerminalFlex>
  );
}
function ParagraphRenderer({ token }: { token: Tokens.Paragraph }) {
  return (
    <TerminalFlex
      style={{
        marginBottom: 1,
      }}
    >
      <Span>{renderChildren(token.tokens)}</Span>
    </TerminalFlex>
  );
}
function StrongRenderer({ token }: { token: Tokens.Strong }) {
  return (
    <Span
      style={{
        fontWeight: "bold",
      }}
    >
      {renderChildren(token.tokens)}
    </Span>
  );
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
      }),
    );
    return Math.max(maxWidth, 3); // Minimum width of 3
  });
  const separator = "├" + columnWidths.map(w => "─".repeat(w + 2)).join("┼") + "┤";
  return (
    <TerminalFlex
      style={{
        flexDirection: "column",
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <TableRowRenderer cells={token.header} columnWidths={columnWidths} isHeader={true} />
      <Span
        style={{
          color: MARKDOWN_TABLE_BORDER_COLOR,
        }}
      >
        {separator}
      </Span>
      {token.rows.map((row, index) => (
        <TableRowRenderer key={index} cells={row} columnWidths={columnWidths} isHeader={false} />
      ))}
    </TerminalFlex>
  );
}
function TableRowRenderer({
  cells,
  columnWidths,
  isHeader,
}: {
  cells: Tokens.TableCell[];
  columnWidths: number[];
  isHeader: boolean;
}) {
  return (
    <TerminalFlex
      style={{
        flexDirection: "row",
      }}
    >
      <Span
        style={{
          color: MARKDOWN_TABLE_BORDER_COLOR,
        }}
      >
        │{" "}
      </Span>
      {cells.map((cell, index) => {
        const cellText = renderTokensAsPlaintext(cell.tokens);
        const paddedText = cellText.padEnd(columnWidths[index]);
        return (
          <React.Fragment key={index}>
            <Span
              style={{
                color: isHeader ? MARKDOWN_TABLE_HEADER_COLOR : MARKDOWN_TABLE_CELL_COLOR,
                fontWeight: "bold",
              }}
            >
              {paddedText}
            </Span>
            <Span
              style={{
                color: MARKDOWN_TABLE_BORDER_COLOR,
              }}
            >
              {" "}
              │{" "}
            </Span>
          </React.Fragment>
        );
      })}
    </TerminalFlex>
  );
}
function TextRenderer({ token }: { token: Tokens.Text }) {
  if (token.tokens) {
    return <Span>{renderChildren(token.tokens)}</Span>;
  }
  return <Span>{token.text}</Span>;
}
function SpaceRenderer() {
  return <></>;
}
function renderTokensAsPlaintext(tokens: Token[]): string {
  return tokens
    .map(token => {
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
      if ("tokens" in token && Array.isArray(token.tokens)) {
        return renderTokensAsPlaintext(token.tokens);
      }
      if ("text" in token) {
        return token.text;
      }
      return "";
    })
    .join("");
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
