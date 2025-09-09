import { describe, it, expect, beforeAll } from "vitest";
import { renderMarkdown } from "./markdown.tsx";
import { render } from "ink-testing-library";

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
  });

  describe("links and images", () => {
    it("preserves link content and applies formatting", () => {
      const result = renderToString("[link text](https://example.com)");
      const stripped = stripAnsi(result);
      expect(stripped).toContain("link text");
      expect(stripped).toContain("https://example.com");
      expect(hasFormatting(result)).toBe(true);
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
        "| Cell 1   | Cell 2   |"
      ].join("\n");

      const result = renderToString(markdown);
      const stripped = stripAnsi(result);
      expect(stripped).toContain("Header 1");
      expect(stripped).toContain("Header 2");
      expect(stripped).toContain("Cell 1");
      expect(stripped).toContain("Cell 2");
      expect(hasFormatting(result)).toBe(true);
    });

    it("handles tables with emojis and multi-width characters", () => {
      const markdown = [
        "| Feature | Status |",
        "|---------|--------|",
        "| Test    | ✅     |"
      ].join("\n");

      const result = renderToString(markdown);
      const stripped = stripAnsi(result);
      expect(stripped).toContain("Feature");
      expect(stripped).toContain("Status");
      expect(stripped).toContain("Test");
      expect(stripped).toContain("✅");
      expect(hasFormatting(result)).toBe(true);
    });
  });

  describe("horizontal rules", () => {
    it("renders horizontal rules with formatting", () => {
      const result = renderToString("---");
      expect(hasFormatting(result)).toBe(true);
      // Should contain some kind of line character
      expect(stripAnsi(result)).toMatch(/[-─]/);
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
        "| Cell  | Data   |"
      ].join("\n");

      const result = renderToString(markdown);
      const stripped = stripAnsi(result);

      // Check all content is preserved
      expect(stripped).toContain("Title");
      expect(stripped).toContain("bold");
      expect(stripped).toContain("code");
      expect(stripped).toContain("List item");
      expect(stripped).toContain("Quote");
      expect(stripped).toContain("Table");
      expect(stripped).toContain("Cell");

      // Check formatting is applied
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
        "   - Another item"
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

function renderToString(markdown: string): string {
  const component = renderMarkdown(markdown);
  const { lastFrame } = render(component);
  return lastFrame() || "";
}

function stripAnsi(str: string): string {
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

function hasFormatting(str: string): boolean {
  // Check for ANSI codes (colors), or typical markdown transformations
  return /\u001b\[[0-9;]*m/.test(str) ||
         str.includes('│') ||  // blockquote markers
         str.includes('┌') ||  // code block borders
         str.includes('█') ||  // heading markers
         str.includes('•') ||  // list bullets
         str !== str.trim();   // additional spacing/formatting
}