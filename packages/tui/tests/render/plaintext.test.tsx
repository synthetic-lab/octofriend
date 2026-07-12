import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	isPlainMarkdownFastPath,
	Markdown,
} from "../../src/render/markdown.tsx";
import {
	isMarkedToken,
	renderTokensAsPlaintext,
} from "../../src/render/plaintext.ts";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

describe("markdown plaintext helpers", () => {
	describe("token guards", () => {
		it("recognizes marked token types and rejects generic tokens", () => {
			expect(isMarkedToken({ type: "text", raw: "hello", text: "hello" })).toBe(
				true,
			);
			expect(isMarkedToken({ type: "custom", raw: "hello" })).toBe(false);
		});

		it("renders plaintext tokens without incremental string churn", () => {
			const tokens = [
				{ type: "text" as const, raw: "alpha", text: "alpha" },
				{
					type: "strong" as const,
					raw: "**beta**",
					text: "beta",
					tokens: [{ type: "text" as const, raw: "beta", text: "beta" }],
				},
				{ type: "codespan" as const, raw: "`delta`", text: "delta" },
				{ type: "br" as const, raw: "  \n" },
				{ type: "text" as const, raw: "epsilon", text: "epsilon" },
				{
					type: "link" as const,
					raw: "[gamma](https://example.com)",
					href: "https://example.com",
					title: null,
					text: "gamma",
					tokens: [{ type: "text" as const, raw: "gamma", text: "gamma" }],
				},
			];

			expect(renderTokensAsPlaintext(tokens)).toBe(
				"alphabetadelta\nepsilongamma (https://example.com)",
			);
			expect(renderTokensAsPlaintext([])).toBe("");
		});
	});

	describe("plain-text fast path", () => {
		it("uses the fast path only for markdown-free assistant text", () => {
			expect(isPlainMarkdownFastPath("plain assistant text")).toBe(true);
			expect(isPlainMarkdownFastPath("first line\nsecond line")).toBe(true);
			expect(isPlainMarkdownFastPath("# heading")).toBe(false);
			expect(isPlainMarkdownFastPath("- list item")).toBe(false);
			expect(isPlainMarkdownFastPath("1. ordered item")).toBe(false);
			expect(isPlainMarkdownFastPath("text with `code`")).toBe(false);
			expect(isPlainMarkdownFastPath("[link](https://example.com)")).toBe(
				false,
			);
			expect(isPlainMarkdownFastPath("    indented code")).toBe(false);
			expect(isPlainMarkdownFastPath("\tindented code")).toBe(false);
		});

		it("renders plain fast-path text without changing copyable content", () => {
			const result = renderToString("plain assistant text\nsecond line");

			expect(stripAnsi(result)).toBe("plain assistant text\nsecond line");
		});

		it("normalizes carriage returns on the plain fast path", () => {
			const result = stripAnsi(renderToString("first\r\nsecond\rthird"));

			expect(result).toBe("first\nsecond\nthird");
			expect(result).not.toContain("\r");
		});
	});
});

function renderToString(markdown: string): string {
	const { lastFrame } = render(<Markdown markdown={markdown} />);
	return lastFrame() || "";
}

function stripAnsi(str: string): string {
	return str.replace(ANSI_PATTERN, "");
}
