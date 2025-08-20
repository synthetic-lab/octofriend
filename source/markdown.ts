import { marked, MarkedToken, Token, Tokens } from "marked";
import chalk from "chalk";
import stringWidth from "string-width";

export function renderMarkdown(markdown: string): string {
  const tokens = marked.lexer(markdown);
  return renderTokens(tokens);
}

function renderTokens(tokens: Token[]): string {
  return tokens.map(renderToken).join("");
}

function renderToken(token: Token): string {
  if (!isMarkedToken(token)) {
    return renderGeneric(token);
  }

  switch (token.type) {
    case "blockquote":
      return renderBlockquote(token);
    case "br":
      return renderBr();
    case "code":
      return renderCode(token);
    case "codespan":
      return renderCodespan(token);
    case "def":
      return renderDef(token);
    case "del":
      return renderDel(token);
    case "em":
      return renderEm(token);
    case "escape":
      return renderEscape(token);
    case "heading":
      return renderHeading(token);
    case "hr":
      return renderHr();
    case "html":
      return renderHtml(token);
    case "image":
      return renderImage(token);
    case "link":
      return renderLink(token);
    case "list":
      return renderList(token);
    case "list_item":
      return renderListItem(token);
    case "paragraph":
      return renderParagraph(token);
    case "strong":
      return renderStrong(token);
    case "table":
      return renderTable(token);
    case "text":
      return renderText(token);
    case "space":
      return renderSpace();
    default:
      return renderGeneric(token);
  }
}

function renderBlockquote(token: Tokens.Blockquote): string {
  const content = renderTokens(token.tokens);
  return content
    .split("\n")
    .map(line => {
      // For nested blockquotes, ensure proper spacing
      const cleanLine = line.replace(/^\s*/, ''); // Remove leading whitespace for consistent formatting
      return chalk.italic(`│ ${cleanLine}`);
    })
    .join("\n") + "\n";
}

function renderBr(): string {
  return "\n";
}

function renderCode(token: Tokens.Code): string {
  const lines = token.text.split('\n');
  const styledLines = lines.map(line => `  ${chalk.white(line)}`);
  const codeText = styledLines.join('\n');

  if (token.lang || token.codeBlockStyle !== "indented") {
    const langTag = token.lang ? chalk.dim(`┌─ ${token.lang} `) + chalk.dim('─'.repeat(Math.max(0, 40 - token.lang.length))) : chalk.dim('┌' + '─'.repeat(42));
    const footer = chalk.dim('└' + '─'.repeat(42));
    return `${langTag}\n${codeText}\n${footer}\n\n`;
  }

  return `${codeText}\n\n`;
}

function renderCodespan(token: Tokens.Codespan): string {
  return chalk.inverse(` ${token.text} `);
}

function renderDef(token: Tokens.Def): string {
  // Don't render definition links which are usually referenced elsewhere.
  return "";
}

function renderDel(token: Tokens.Del): string {
  return chalk.strikethrough.dim(renderTokens(token.tokens));
}

function renderEm(token: Tokens.Em): string {
  return chalk.italic(renderTokens(token.tokens));
}

function renderEscape(token: Tokens.Escape): string {
  return token.text;
}

function renderHeading(token: Tokens.Heading): string {
  const content = renderTokens(token.tokens);
  const indent = "  ".repeat(Math.max(0, token.depth - 1));

  const colors = [
    chalk.magenta.bold,
    chalk.blue.bold,
    chalk.cyan.bold,
    chalk.green.bold,
    chalk.yellow.bold,
    chalk.red.bold
  ];

  const colorFn = colors[Math.min(token.depth - 1, colors.length - 1)];
  const marker = token.depth === 1 ? "█" : token.depth === 2 ? "▆" : "▉";

  return `\n${indent}${colorFn(`${marker} ${content.trim()}`)}\n\n`;
}

function renderHr(): string {
  const width = Math.min(process.stdout.columns || 80, 80);
  return "\n" + chalk.dim("─".repeat(width)) + "\n\n";
}

function renderHtml(token: Tokens.HTML | Tokens.Tag): string {
  return token.text;
}

function renderImage(token: Tokens.Image): string {
  return chalk.yellow(`[Image: ${token.text}]`);
}

function renderLink(token: Tokens.Link): string {
  const content = renderTokens(token.tokens);
  return `${chalk.blue.underline(content)} ${chalk.dim.cyan(`(${token.href})`)}`;;
}

function renderList(token: Tokens.List): string {
  return token.items.map((item, index) => {
    let prefix = chalk.cyan("• ");
    if (token.ordered) {
      const num = (typeof token.start === "number" ? token.start : 1) + index;
      prefix = chalk.cyan(`${num}. `);
    }
    const itemContent = renderListItem(item);
    return "  " + prefix + itemContent + "\n";
  }).join("") + "\n";
}

function renderListItem(token: Tokens.ListItem): string {
  const renderedTokens = token.tokens.map((childToken, index) => {
    const rendered = renderToken(childToken);
    
    // For nested lists, code blocks, and blockquotes, add proper indentation
    if (childToken.type === 'list' || childToken.type === 'code' || childToken.type === 'blockquote') {
      // Add indentation to align with list content (after the bullet point)
      const indented = rendered.split('\n').map((line, lineIndex) => {
        return line ? `    ${line}` : line; // Indent all lines including first
      }).join('\n');
      
      // Add newline before nested content if there's preceding content
      if (index > 0) {
        return '\n' + indented;
      }
      return indented;
    }
    
    // For paragraphs in list items, reduce double newlines to single
    if (childToken.type === 'paragraph') {
      // If this paragraph is followed by nested content, ensure it ends with single newline
      if (index < token.tokens.length - 1) {
        const nextToken = token.tokens[index + 1];
        if (nextToken.type === 'list' || nextToken.type === 'code' || nextToken.type === 'blockquote') {
          return rendered.replace(/\n\n$/, '\n').replace(/\n$/, '');
        }
        return rendered.replace(/\n\n$/, '\n');
      }
      return rendered.replace(/\n\n$/, '');
    }
    
    return rendered;
  });
  
  let content = renderedTokens.join('').trim();
  
  if (token.task && typeof token.checked === "boolean") {
    const checkbox = token.checked ? chalk.green("[✓]") : chalk.dim("[ ]");
    content = `${checkbox} ${content}`;
  }
  
  return content;
}

function renderParagraph(token: Tokens.Paragraph): string {
  const content = renderTokens(token.tokens);
  return content.trim() + "\n\n";
}

function renderStrong(token: Tokens.Strong): string {
  return chalk.bold(renderTokens(token.tokens));
}

function renderTable(token: Tokens.Table): string {
  // Calculate column widths by measuring display width of all content
  const allRows = [token.header, ...token.rows];
  const columnWidths = token.header.map((_, colIndex) => {
    const maxWidth = Math.max(
      ...allRows.map(row => {
        const cell = row[colIndex];
        if (cell) {
          const content = renderTableCell(cell);
          // Strip ANSI codes first, then measure display width
          const plainContent = content.replace(/\u001b\[[0-9;]*m/g, '');
          return stringWidth(plainContent);
        }
        return 0;
      })
    );
    return Math.max(maxWidth, 3); // Minimum width of 3
  });

  const headerRow = renderTableRow(token.header, columnWidths, true);
  const separator = chalk.dim("├" + columnWidths.map(w => "─".repeat(w + 2)).join("┼") + "┤\n");
  const rows = token.rows.map(row => renderTableRow(row, columnWidths, false));
  return "\n" + headerRow + separator + rows.join("") + "\n";
}

function renderTableRow(cells: Tokens.TableCell[], columnWidths: number[], isHeader: boolean = false): string {
  const cellContents = cells.map((cell, index) => {
    const content = renderTableCell(cell);
    const plainContent = content.replace(/\u001b\[[0-9;]*m/g, '');
    const displayWidth = stringWidth(plainContent);
    const padding = " ".repeat(Math.max(0, columnWidths[index] - displayWidth));
    const styledContent = isHeader ? chalk.bold.cyan(content) : content;
    return styledContent + padding;
  });
  const border = chalk.dim("│");
  return `${border} ${cellContents.join(` ${border} `)} ${border}\n`;
}

function renderTableCell(token: Tokens.TableCell): string {
  return renderTokens(token.tokens);
}

function renderText(token: Tokens.Text): string {
  if (token.tokens) {
    return renderTokens(token.tokens);
  }
  return token.text;
}

function renderSpace(): string {
  return "";
}

function renderGeneric(token: Tokens.Generic): string {
  if (token.tokens) {
    return renderTokens(token.tokens);
  }
  return token.raw || "";
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
 * Marked provides a `Tokens.Generic` interface with a string type for extensions, which breaks
 * type narrowing for `Token`, so we check that the token is not generic (ie. a `MarkedToken`) here.
 * https://github.com/markedjs/marked/issues/2938
 */
function isMarkedToken(token: Token): token is MarkedToken {
  return MARKED_TOKEN_TYPES.includes(token.type);
}