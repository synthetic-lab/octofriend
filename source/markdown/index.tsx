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
import { Div, Span } from "paintcannon-react";
export function Markdown({ markdown }: { markdown: string }) {
  const tokens = marked.lexer(markdown);
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
      }}
    >
      {tokens.map((token, index) => (
        <TokenRenderer key={index} token={token} />
      ))}
    </Div>
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
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        paddingLeft: 2,
      }}
    >
      <Span
        style={{
          color: "gray",
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
    </Div>
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
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
          marginBottom: 1,
        }}
      >
        <Span
          style={{
            color: "gray",
          }}
        >
          {langTag}
        </Span>
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            paddingLeft: 2,
            flexDirection: "column",
          }}
        >
          <HighlightedCode code={token.text} language={token.lang} />
        </Div>
        <Span
          style={{
            color: "gray",
          }}
        >
          {footer}
        </Span>
      </Div>
    );
  }
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        marginBottom: 1,
        paddingLeft: 2,
      }}
    >
      <HighlightedCode code={token.text} language={token.lang} />
    </Div>
  );
}
function CodespanRenderer({ token }: { token: Tokens.Codespan }) {
  return (
    <Span
      style={{
        color: "#b8c2d1",
        backgroundColor: "#182b42",
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
        color: "gray",
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

  const colors = ["#d4d4d4", "#c8c8c8", "#bfc3c7", "#b9b8c0", "#b5b0bb", "#afa9b5"];
  const color = colors[Math.min(token.depth - 1, colors.length - 1)];
  const marker = "#".repeat(token.depth);
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
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
    </Div>
  );
}
function HrRenderer() {
  const width = Math.min(process.stdout.columns || 80, 80);
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <Span
        style={{
          color: "gray",
        }}
      >
        {"─".repeat(width)}
      </Span>
    </Div>
  );
}
function HtmlRenderer({ token }: { token: Tokens.HTML | Tokens.Tag }) {
  return <Span>{token.text}</Span>;
}
function ImageRenderer({ token }: { token: Tokens.Image }) {
  return (
    <Span
      style={{
        color: "yellow",
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
        color: "blue",
      }}
    >
      {linkText} ({token.href}){renderChildren(token.tokens)} ({token.href})
    </Span>
  );
}
function ListRenderer({ token }: { token: Tokens.List }) {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        paddingLeft: 0,
        marginBottom: 1,
      }}
    >
      {token.items.map((item, index) => (
        <Div
          key={index}
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            flexDirection: "row",
          }}
        >
          <Span
            style={{
              color: "cyan",
            }}
          >
            {token.ordered
              ? `${(typeof token.start === "number" ? token.start : 1) + index}. `
              : "• "}
          </Span>
          <ListItemRenderer token={item} />
        </Div>
      ))}
    </Div>
  );
}
function ListItemRenderer({ token }: { token: Tokens.ListItem }) {
  if (token.task && typeof token.checked === "boolean") {
    // For task items, render checkbox and content inline
    return (
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
          flexGrow: 1,
        }}
      >
        <Div
          style={{
            display: "flex",
            whiteSpace: "pre-wrap",
            flexDirection: "row",
          }}
        >
          <Span
            style={{
              color: token.checked ? "green" : "gray",
            }}
          >
            {token.checked ? "[✓]" : "[ ]"}{" "}
          </Span>
          <Div
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
              flexDirection: "column",
              flexGrow: 1,
            }}
          >
            {token.tokens.map((childToken, index) => (
              <Div
                key={index}
                style={{
                  display: "flex",
                  whiteSpace: "pre-wrap",
                  paddingLeft:
                    childToken.type === "list" ||
                    childToken.type === "code" ||
                    childToken.type === "blockquote"
                      ? 1
                      : 0,
                }}
              >
                <TokenRenderer token={childToken} />
              </Div>
            ))}
          </Div>
        </Div>
      </Div>
    );
  }

  // For regular list items
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        flexGrow: 1,
      }}
    >
      <Div
        style={{
          display: "flex",
          whiteSpace: "pre-wrap",
          flexDirection: "column",
        }}
      >
        {token.tokens.map((childToken, index) => (
          <Div
            key={index}
            style={{
              display: "flex",
              whiteSpace: "pre-wrap",
              paddingLeft:
                childToken.type === "list" ||
                childToken.type === "code" ||
                childToken.type === "blockquote"
                  ? 1
                  : 0,
            }}
          >
            <TokenRenderer token={childToken} />
          </Div>
        ))}
      </Div>
    </Div>
  );
}
function ParagraphRenderer({ token }: { token: Tokens.Paragraph }) {
  return (
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        marginBottom: 1,
      }}
    >
      <Span>{renderChildren(token.tokens)}</Span>
    </Div>
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
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "column",
        marginTop: 1,
        marginBottom: 1,
      }}
    >
      <TableRowRenderer cells={token.header} columnWidths={columnWidths} isHeader={true} />
      <Span
        style={{
          color: "gray",
        }}
      >
        {separator}
      </Span>
      {token.rows.map((row, index) => (
        <TableRowRenderer key={index} cells={row} columnWidths={columnWidths} isHeader={false} />
      ))}
    </Div>
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
    <Div
      style={{
        display: "flex",
        whiteSpace: "pre-wrap",
        flexDirection: "row",
      }}
    >
      <Span
        style={{
          color: "gray",
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
                color: isHeader ? "cyan" : "white",
                fontWeight: "bold",
              }}
            >
              {paddedText}
            </Span>
            <Span
              style={{
                color: "gray",
              }}
            >
              {" "}
              │{" "}
            </Span>
          </React.Fragment>
        );
      })}
    </Div>
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
