import { describe, expect, it } from "bun:test";
import hljs from "highlight.js";
import { render } from "ink-testing-library";
import { HighlightedCode } from "../../src/render/highlight";

describe("HighlightedCode", () => {
	it("renders no-language code blocks as plain text without auto highlighting", () => {
		const highlightAuto = hljs.highlightAuto;
		let autoCalls = 0;
		hljs.highlightAuto = ((code: string) => {
			autoCalls += 1;
			return highlightAuto.call(hljs, code);
		}) as unknown as typeof hljs.highlightAuto;
		try {
			const { lastFrame } = render(
				<HighlightedCode code={'const text = "&<>";'} />,
			);

			expect(autoCalls).toBe(0);
			expect(lastFrame() ?? "").toContain('const text = "&<>";');
		} finally {
			hljs.highlightAuto = highlightAuto;
		}
	});

	it("renders unknown-language code blocks as plain text without auto highlighting", () => {
		const highlightAuto = hljs.highlightAuto;
		let autoCalls = 0;
		hljs.highlightAuto = ((code: string) => {
			autoCalls += 1;
			return highlightAuto.call(hljs, code);
		}) as unknown as typeof hljs.highlightAuto;
		try {
			const { lastFrame } = render(
				<HighlightedCode
					code={"<not-a-language>"}
					language="octofwen-missing"
				/>,
			);

			expect(autoCalls).toBe(0);
			expect(lastFrame() ?? "").toContain("<not-a-language>");
		} finally {
			hljs.highlightAuto = highlightAuto;
		}
	});

	it("preserves blank lines while rendering highlighted code", () => {
		const { lastFrame } = render(
			<HighlightedCode code={"const a = 1;\n\nconst b = 2;"} language="ts" />,
		);

		const outputLines = (lastFrame() ?? "").split("\n");
		const firstLineIndex = outputLines.findIndex((line) => line.includes("a"));
		const secondLineIndex = outputLines.findIndex((line) => line.includes("b"));

		expect(firstLineIndex).toBeGreaterThanOrEqual(0);
		expect(secondLineIndex).toBeGreaterThan(firstLineIndex + 1);
	});

	it("normalizes CRLF and CR line endings while rendering code", () => {
		const { lastFrame } = render(
			<HighlightedCode code={"const a = 1;\r\n\rconst b = 2;"} language="ts" />,
		);

		const output = lastFrame() ?? "";
		const outputLines = output.split("\n");
		const firstLineIndex = outputLines.findIndex((line) => line.includes("a"));
		const secondLineIndex = outputLines.findIndex((line) => line.includes("b"));

		expect(output).not.toContain("\r");
		expect(firstLineIndex).toBeGreaterThanOrEqual(0);
		expect(secondLineIndex).toBeGreaterThan(firstLineIndex + 1);
	});

	it("decodes highlighted HTML entities without changing copied text", () => {
		const { lastFrame } = render(
			<HighlightedCode code={'const text = "&<>\'"; // &<>'} language="ts" />,
		);

		const frame = lastFrame() ?? "";
		expect(frame).toContain('"&<>\'"');
		expect(frame).toContain("// &<>");
		expect(frame).not.toContain("&amp;");
		expect(frame).not.toContain("&lt;");
		expect(frame).not.toContain("&gt;");
	});

	it("preserves unknown ampersand sequences exactly", () => {
		const { lastFrame } = render(
			<HighlightedCode code={'const value = "&bogus; &";'} language="ts" />,
		);

		expect(lastFrame() ?? "").toContain('"&bogus; &"');
	});

	it("decodes adjacent and later entities after unknown ampersands", () => {
		const highlight = hljs.highlight;
		hljs.highlight = (() => ({
			value: '<span class="hljs-string">"&amp;&lt;&bogus;&gt;"</span>',
			language: "ts",
			relevance: 1,
			illegal: false,
		})) as unknown as typeof hljs.highlight;
		try {
			const { lastFrame } = render(<HighlightedCode code="" language="ts" />);

			expect(lastFrame() ?? "").toContain('"&<&bogus;>"');
		} finally {
			hljs.highlight = highlight;
		}
	});

	it("decodes decimal and hex numeric HTML entities from highlighters", () => {
		const highlight = hljs.highlight;
		hljs.highlight = (() => ({
			value: '<span class="hljs-string">"&#47;&#x60;&#x1F642;&#X41;"</span>',
			language: "ts",
			relevance: 1,
			illegal: false,
		})) as unknown as typeof hljs.highlight;
		try {
			const { lastFrame } = render(<HighlightedCode code="" language="ts" />);

			expect(lastFrame() ?? "").toContain('"/`🙂A"');
		} finally {
			hljs.highlight = highlight;
		}
	});

	it("preserves remaining text when highlighted HTML has malformed spans", () => {
		const highlight = hljs.highlight;
		hljs.highlight = ((code: string) => ({
			value: `before <span class="hljs-string">${code}`,
			language: "ts",
			relevance: 1,
			illegal: false,
		})) as unknown as typeof hljs.highlight;
		try {
			const { lastFrame } = render(
				<HighlightedCode code={"after &amp; text"} language="ts" />,
			);

			const frame = lastFrame() ?? "";
			expect(frame).toContain('before <span class="hljs-string">after & text');
		} finally {
			hljs.highlight = highlight;
		}
	});
});
