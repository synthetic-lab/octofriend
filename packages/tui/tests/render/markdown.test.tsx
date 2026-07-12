import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import type { Tokens } from "marked";
import { Fragment } from "react";
import stringWidth from "string-width";
import { TerminalSizeProvider } from "../../src/layout/viewport.tsx";
import { renderPlainCodeLines } from "../../src/render/line-highlight.tsx";
import {
	isPlainMarkdownFastPath,
	Markdown,
} from "../../src/render/markdown.tsx";
import { TableRenderer } from "../../src/render/table.tsx";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const ANSI_TEST_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`);
const HORIZONTAL_RULE_PATTERN = /[-─]/;

describe("renderToString", () => {
	describe("basic functionality", () => {
		it("renders plain text and preserves content", () => {
			const result = renderToString("Hello world");
			expect(stripAnsi(result)).toContain("Hello world");
		});

		it("preserves content across multiple lines", () => {
			const result = renderToString("First line\nSecond line");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("First line");
			expect(stripped).toContain("Second line");
		});
	});

	describe("headings", () => {
		it("preserves heading text and applies formatting", () => {
			const result = renderToString("# Main Title\n## Subtitle");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Main Title");
			expect(stripped).toContain("Subtitle");
			expect(hasFormatting(result)).toBe(true);
		});

		it("handles nested formatting in headings", () => {
			const result = renderToString("# Heading with **bold** text");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Heading with");
			expect(stripped).toContain("bold");
			expect(stripped).toContain("text");
			expect(hasFormatting(result)).toBe(true);
		});
	});

	describe("text formatting", () => {
		it("preserves bold text content and applies formatting", () => {
			const result = renderToString("**bold text**");
			expect(stripAnsi(result)).toContain("bold text");
			expect(hasFormatting(result)).toBe(true);
		});

		it("preserves italic text content and applies formatting", () => {
			const result = renderToString("*italic text*");
			expect(stripAnsi(result)).toContain("italic text");
			expect(hasFormatting(result)).toBe(true);
		});

		it("preserves strikethrough text content and applies formatting", () => {
			const result = renderToString("~~strikethrough text~~");
			expect(stripAnsi(result)).toContain("strikethrough text");
			expect(hasFormatting(result)).toBe(true);
		});

		it("handles mixed formatting", () => {
			const result = renderToString("**bold** and *italic* and ~~strike~~");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("bold");
			expect(stripped).toContain("italic");
			expect(stripped).toContain("strike");
			expect(hasFormatting(result)).toBe(true);
		});
	});

	describe("code", () => {
		it("preserves inline code content and applies formatting", () => {
			const result = renderToString("`inline code`");
			expect(stripAnsi(result)).toContain("inline code");
			expect(hasFormatting(result)).toBe(true);
		});

		it("preserves code block content and applies formatting", () => {
			const code = "function test() {\n  return 'hello';\n}";
			const result = renderToString(`\`\`\`javascript\n${code}\n\`\`\``);
			const stripped = stripAnsi(result);
			expect(stripped).toContain("function test()");
			expect(stripped).toContain("return 'hello'");
			expect(hasFormatting(result)).toBe(true);
		});

		it("handles code blocks without language", () => {
			const result = renderToString("```\nplain code\n```");
			expect(stripAnsi(result)).toContain("plain code");
			expect(hasFormatting(result)).toBe(true);
		});

		it("keeps indented code blocks out of the plain-text fast path", () => {
			const result = renderToString("    plain code");

			expect(isPlainMarkdownFastPath("    plain code")).toBe(false);
			expect(stripAnsi(result)).toContain("plain code");
			expect(hasFormatting(result)).toBe(true);
		});

		it("does not add copyable spaces for blank lines inside code blocks", () => {
			const result = stripAnsi(renderToString("```\nalpha\n\nbeta\n```"));

			expect(result).toContain("  alpha\n\n  beta");
			expect(result).not.toContain("  alpha\n  \n  beta");
		});

		it("does not add copyable spaces for blank lines in plain code fallback", () => {
			const { lastFrame } = render(
				<Fragment key="plain-code">
					{renderPlainCodeLines("alpha\n\nbeta")}
				</Fragment>,
			);
			const result = stripAnsi(lastFrame() || "");

			expect(result).toBe("alpha\n\nbeta");
		});
	});

	describe("links and images", () => {
		it("preserves link content and applies formatting", () => {
			const result = renderToString("[link text](https://example.com)");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("link text");
			expect(stripped).toContain("https://example.com");
			expect(hasFormatting(result)).toBe(true);
		});

		it("renders link label and target once", () => {
			const result = stripAnsi(
				renderToString("[link text](https://example.com)"),
			);

			expect(countOccurrences(result, "link text")).toBe(1);
			expect(countOccurrences(result, "https://example.com")).toBe(1);
		});

		it("preserves image alt text", () => {
			const result = renderToString("![alt text](image.jpg)");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Image: alt text");
			expect(hasFormatting(result)).toBe(true);
		});
	});

	describe("lists", () => {
		it("preserves unordered list content and applies formatting", () => {
			const result = renderToString("- Item 1\n- Item 2\n- Item 3");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Item 1");
			expect(stripped).toContain("Item 2");
			expect(stripped).toContain("Item 3");
			expect(hasFormatting(result)).toBe(true);
		});

		it("preserves ordered list content and applies formatting", () => {
			const result = renderToString("1. First\n2. Second\n3. Third");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("First");
			expect(stripped).toContain("Second");
			expect(stripped).toContain("Third");
			expect(hasFormatting(result)).toBe(true);
		});

		it("handles task lists", () => {
			const result = renderToString("- [ ] Todo\n- [x] Done");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Todo");
			expect(stripped).toContain("Done");
			expect(countOccurrences(stripped, "[ ]")).toBe(1);
			expect(countOccurrences(stripped, "[✓]")).toBe(1);
			expect(hasFormatting(result)).toBe(true);
		});

		it("handles nested lists", () => {
			const result = renderToString("- Main\n  - Nested\n- Another");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Main");
			expect(stripped).toContain("Nested");
			expect(stripped).toContain("Another");
			expect(hasFormatting(result)).toBe(true);
		});
	});

	describe("blockquotes", () => {
		it("preserves blockquote content and applies formatting", () => {
			const result = renderToString("> This is a quote");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("This is a quote");
			expect(hasFormatting(result)).toBe(true);
		});

		it("handles multi-line blockquotes", () => {
			const result = renderToString("> Line 1\n> Line 2");
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Line 1");
			expect(stripped).toContain("Line 2");
			expect(hasFormatting(result)).toBe(true);
		});
	});

	describe("tables", () => {
		it("preserves table content and applies formatting", () => {
			const markdown = [
				"| Header 1 | Header 2 |",
				"|----------|----------|",
				"| Cell 1   | Cell 2   |",
			].join("\n");

			const result = renderToString(markdown);
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Header 1");
			expect(stripped).toContain("Header 2");
			expect(stripped).toContain("Cell 1");
			expect(stripped).toContain("Cell 2");
			expect(hasFormatting(result)).toBe(true);
		});

		it("does not add fake spaces around inline code inside tables", () => {
			const markdown = [
				"| Key | Value |",
				"|-----|-------|",
				"| env | `OPENAI_API_KEY` |",
			].join("\n");

			const stripped = stripAnsi(renderToString(markdown));

			expect(stripped).toContain("│ env │ OPENAI_API_KEY │");
			expect(stripped).not.toContain(" OPENAI_API_KEY  │");
		});

		it("handles tables with emojis and multi-width characters", () => {
			const markdown = [
				"| Feature | Status |",
				"|---------|--------|",
				"| Test    | ✅     |",
				"| Warn    | ⚠️ x   |",
			].join("\n");

			const result = renderToString(markdown);
			const stripped = stripAnsi(result);
			expect(stripped).toContain("Feature");
			expect(stripped).toContain("Status");
			expect(stripped).toContain("Test");
			expect(stripped).toContain("✅");
			expect(stripped).toContain("⚠️ x");
			expect(tableLineWidths(stripped)).toEqual([20, 20, 20, 20]);
			expect(hasFormatting(result)).toBe(true);
		});

		it("keeps rows aligned when table cells are missing", () => {
			const token: Tokens.Table = {
				type: "table",
				raw: "",
				align: [null, null],
				header: [tableCell("Key", true), tableCell("Value", true)],
				rows: [[tableCell("only", false)]],
			};

			const { lastFrame } = render(<TableRenderer token={token} />);
			const stripped = stripAnsi(lastFrame() || "");
			const tableLines = stripped
				.split("\n")
				.filter((line) => line.includes("│") || line.includes("├"));

			expect(tableLines).toHaveLength(3);
			expect(tableLineWidths(stripped)).toEqual([16, 16, 16]);
			expect(tableLines[2]).toContain("│ only │       │");
		});

		it("normalizes tabs inside table cells to copy-safe spaces", () => {
			const token: Tokens.Table = {
				type: "table",
				raw: "",
				align: [null, null],
				header: [tableCell("Key", true), tableCell("Value", true)],
				rows: [[tableCell("alpha\tbeta", false), tableCell("ok", false)]],
			};

			const { lastFrame } = render(<TableRenderer token={token} />);
			const stripped = stripAnsi(lastFrame() || "");

			expect(stripped).toContain("alpha beta");
			expect(stripped).not.toContain("\t");
		});

		it("keeps hard breaks inside table cells on one rendered row", () => {
			const token: Tokens.Table = {
				type: "table",
				raw: "",
				align: [null, null],
				header: [tableCell("Key", true), tableCell("Value", true)],
				rows: [
					[
						{
							text: "alpha\nbeta",
							tokens: [
								{ type: "text", raw: "alpha", text: "alpha" },
								{ type: "br", raw: "  \n" },
								{ type: "text", raw: "beta", text: "beta" },
							],
							header: false,
							align: null,
						},
						tableCell("ok", false),
					],
				],
			};

			const { lastFrame } = render(<TableRenderer token={token} />);
			const stripped = stripAnsi(lastFrame() || "");
			const tableLines = stripped
				.split("\n")
				.filter((line) => line.includes("│") || line.includes("├"));

			expect(stripped).toContain("│ alpha beta │ ok");
			expect(stripped).not.toContain("alpha\nbeta");
			expect(tableLines).toHaveLength(3);
		});
	});

	describe("horizontal rules", () => {
		it("renders horizontal rules with formatting", () => {
			const result = renderToString("---");
			expect(hasFormatting(result)).toBe(true);
			expect(stripAnsi(result)).toMatch(HORIZONTAL_RULE_PATTERN);
		});

		it("uses terminal size context for horizontal rule width", () => {
			const result = renderToString("---", { width: 20, height: 10 });
			const rule = stripAnsi(result)
				.split("\n")
				.find((line) => line.includes("─"));

			expect(rule).toBe("─".repeat(20));
		});
	});

	describe("complex content", () => {
		it("handles mixed content types", () => {
			const markdown = [
				"# Title",
				"",
				"Some **bold** text with `code`.",
				"",
				"- List item",
				"",
				"> Quote",
				"",
				"| Table | Header |",
				"|-------|--------|",
				"| Cell  | Data   |",
			].join("\n");

			const result = renderToString(markdown);
			const stripped = stripAnsi(result);

			expect(stripped).toContain("Title");
			expect(stripped).toContain("bold");
			expect(stripped).toContain("code");
			expect(stripped).toContain("List item");
			expect(stripped).toContain("Quote");
			expect(stripped).toContain("Table");
			expect(stripped).toContain("Cell");

			expect(hasFormatting(result)).toBe(true);
		});

		it("handles nested content in lists", () => {
			const markdown = [
				"1. First item:",
				"   ```bash",
				"   npm install",
				"   ```",
				"",
				"2. Second item:",
				"   - Nested list",
				"   - Another item",
			].join("\n");

			const result = renderToString(markdown);
			const stripped = stripAnsi(result);

			expect(stripped).toContain("First item");
			expect(stripped).toContain("npm install");
			expect(stripped).toContain("Second item");
			expect(stripped).toContain("Nested list");
			expect(stripped).toContain("Another item");
			expect(hasFormatting(result)).toBe(true);
		});
	});

	describe("edge cases", () => {
		it("handles empty input", () => {
			const result = renderToString("");
			expect(result).toBe("");
		});

		it("handles whitespace-only input", () => {
			const result = renderToString("   \n   ");
			expect(stripAnsi(result).trim()).toBe("");
		});

		it("preserves special characters", () => {
			const result = renderToString("Special chars: & < > \" '");
			expect(stripAnsi(result)).toContain("Special chars: & < > \" '");
		});
	});
});

function renderToString(
	markdown: string,
	size?: { width: number; height: number },
): string {
	const element = size ? (
		<TerminalSizeProvider size={size}>
			<Markdown markdown={markdown} />
		</TerminalSizeProvider>
	) : (
		<Markdown markdown={markdown} />
	);
	const { lastFrame } = render(element);
	return lastFrame() || "";
}

function tableCell(text: string, header: boolean): Tokens.TableCell {
	return {
		text,
		tokens: [{ type: "text", raw: text, text }],
		header,
		align: null,
	};
}

function stripAnsi(str: string): string {
	return str.replace(ANSI_PATTERN, "");
}

function countOccurrences(value: string, search: string): number {
	let count = 0;
	let index = value.indexOf(search);
	while (index !== -1) {
		count += 1;
		index = value.indexOf(search, index + search.length);
	}
	return count;
}

function tableLineWidths(value: string): number[] {
	return value
		.split("\n")
		.filter((line) => line.includes("│") || line.includes("├"))
		.map((line) => stringWidth(line));
}

function hasFormatting(str: string): boolean {
	// Check for ANSI codes (colors), or typical markdown transformations
	return (
		ANSI_TEST_PATTERN.test(str) ||
		str.includes("│") || // blockquote markers
		str.includes("┌") || // code block borders
		str.includes("█") || // heading markers
		str.includes("•") || // list bullets
		str !== str.trim()
	); // additional spacing/formatting
}
