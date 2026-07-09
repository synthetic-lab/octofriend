import { describe, expect, it } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import { extractTrim } from "../../src/shell/text-processing";
import { TerminalSizeProvider } from "../../src/layout/viewport";
import { DiffRenderer, FileRenderer } from "../../src/render/code";
import {
	buildLineCounter,
	LineSegments,
	renderableCodeLineParts,
} from "../../src/render/line-segments";
import {
	countLfLinesDropTrailingEmpty,
	countRenderedLinesDropTrailingEmpty,
	splitLfLines,
	splitLfLinesDropTrailingEmpty,
	splitRenderedLines,
} from "../../src/render/lines";

describe("line splitting", () => {
	it("splits LF lines while preserving split newline semantics", () => {
		expect(splitLfLines("")).toEqual([""]);
		expect(splitLfLines("one\ntwo\n")).toEqual(["one", "two", ""]);
		expect(splitLfLines("one\r\ntwo")).toEqual(["one\r", "two"]);
		expect(splitLfLinesDropTrailingEmpty("one\ntwo\n")).toEqual(["one", "two"]);
		expect(countLfLinesDropTrailingEmpty("")).toBe(0);
		expect(countLfLinesDropTrailingEmpty(undefined)).toBe(0);
		expect(countLfLinesDropTrailingEmpty("one\ntwo\n")).toBe(2);
		expect(countLfLinesDropTrailingEmpty("one\r\ntwo")).toBe(2);
		expect(splitLfLinesDropTrailingEmpty(undefined)).toEqual([]);
	});

	it("splits rendered lines across LF, CRLF, and CR endings", () => {
		expect(splitRenderedLines("one\ntwo\n")).toEqual(["one", "two", ""]);
		expect(splitRenderedLines("one\r\ntwo")).toEqual(["one", "two"]);
		expect(splitRenderedLines("one\rtwo\r")).toEqual(["one", "two", ""]);
		expect(countRenderedLinesDropTrailingEmpty("")).toBe(0);
		expect(countRenderedLinesDropTrailingEmpty(undefined)).toBe(0);
		expect(countRenderedLinesDropTrailingEmpty("one\ntwo\n")).toBe(2);
		expect(countRenderedLinesDropTrailingEmpty("one\r\ntwo")).toBe(2);
		expect(countRenderedLinesDropTrailingEmpty("one\rtwo\r")).toBe(2);
	});
});

describe("FileRenderer", () => {
	it("renders content starting from line 1 by default", () => {
		const { lastFrame } = render(
			<FileRenderer
				contents="function example() {\n  return 'hello';\n}"
				filePath="/test/example.js"
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("function example() {");
		expect(output).toContain("return 'hello'");
		expect(output).toContain("1");
	});

	it("uses startLineNr when provided", () => {
		const { lastFrame } = render(
			<FileRenderer
				contents="appended line"
				filePath="/test.txt"
				startLineNr={10}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("10");
		expect(output).toContain("appended line");
	});

	it("does not duplicate all-whitespace lines while splitting indentation", () => {
		expect(extractTrim("   ")).toEqual(["   ", "", ""]);
		expect(extractTrim("		")).toEqual(["		", "", ""]);
	});

	it("renders multiple lines starting from provided line number", () => {
		const { lastFrame } = render(
			<FileRenderer
				contents="line 1\nline 2\nline 3"
				filePath="/test.txt"
				startLineNr={5}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("line 1");
		expect(output).toContain("line 2");
		expect(output).toContain("line 3");
		expect(output).toContain("5");
	});

	it("normalizes CRLF and CR line endings before rendering file text", () => {
		const { lastFrame } = render(
			<FileRenderer
				contents={"line 1\r\nline 2\rline 3"}
				filePath="/test.txt"
				startLineNr={5}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("line 1");
		expect(output).toContain("line 2");
		expect(output).toContain("line 3");
		expect(output).not.toContain("\r");
		expect(output).toContain("5");
		expect(output).toContain("6");
		expect(output).toContain("7");
	});
});

describe("LineSegments", () => {
	it("does not render copyable placeholders for empty side-by-side panes", () => {
		const { lastFrame } = render(
			<LineSegments
				value=""
				language="txt"
				gutterColor="gray"
				gutterWidth={4}
				lineCounter={buildLineCounter(1)}
				originalLines={[]}
			>
				<Text>{"  "}</Text>
			</LineSegments>,
		);

		expect(lastFrame()).toBe("");
	});

	it("normalizes CR-only diff source lines before rendering", () => {
		const oldText = "alpha\rbeta\r";
		const newText = "alpha\rgamma\r";

		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 60, height: 20 }}>
				<DiffRenderer
					oldText={oldText}
					newText={newText}
					filepath="/test.txt"
					fileContents={`prefix\r${oldText}`}
				/>
			</TerminalSizeProvider>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("2 -  alpha");
		expect(output).toContain("3 -  beta");
		expect(output).toContain("2 +  alpha");
		expect(output).toContain("3 +  gamma");
		expect(output).not.toContain("\r");
	});

	it("keeps blank diff source lines visually blank without copyable filler text", () => {
		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 60, height: 20 }}>
				<DiffRenderer
					oldText={"alpha\n\nbeta\n"}
					newText={"alpha\n\nbeta\n"}
					filepath="/test.txt"
					fileContents={"alpha\n\nbeta\n"}
				/>
			</TerminalSizeProvider>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("1    alpha\n 2\n 3    beta");
		expect(output).not.toContain("2     ");
	});
});

describe("DiffRenderer", () => {
	it("renders diff when it can find oldText in file content", () => {
		const oldText = "line 1\nline 2\nline 3\n";

		const { lastFrame } = render(
			<DiffRenderer
				oldText={oldText}
				newText="line 1\nmodified line\nline 3\n"
				filepath="/test.txt"
				fileContents={oldText}
			/>,
		);

		const output = lastFrame() || "";
		expect(output.length).toBeGreaterThan(0);
		expect(output).toContain("Old");
		expect(output).toContain("New");
	});

	it("starts diff gutters at the matching line in the full file", () => {
		const oldText = "target 1\ntarget 2\n";
		const fileContents = `prefix 1\nprefix 2\n${oldText}suffix\n`;

		const { lastFrame } = render(
			<DiffRenderer
				oldText={oldText}
				newText="target 1\nchanged target\n"
				filepath="/test.txt"
				fileContents={fileContents}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("3");
		expect(output).toContain("target 1");
		expect(output).toContain("changed target");
	});

	it("stacks old and new diff panes for small terminal widths", () => {
		const oldText = "line 1\nline 2\nline 3\n";

		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 60, height: 20 }}>
				<DiffRenderer
					oldText={oldText}
					newText="line 1\nmodified line\nline 3\n"
					filepath="/test.txt"
					fileContents={oldText}
				/>
			</TerminalSizeProvider>,
		);

		const output = lastFrame() || "";
		const lines = output.split("\n");

		expect(
			lines.some((line) => line.includes("Old") && line.includes("New")),
		).toBe(false);
		expect(output.indexOf("Old")).toBeLessThan(output.indexOf("New"));
	});

	it("keeps old and new diff panes side by side for wide terminal widths", () => {
		const oldText = "line 1\nline 2\nline 3\n";

		const { lastFrame } = render(
			<TerminalSizeProvider size={{ width: 120, height: 20 }}>
				<DiffRenderer
					oldText={oldText}
					newText="line 1\nmodified line\nline 3\n"
					filepath="/test.txt"
					fileContents={oldText}
				/>
			</TerminalSizeProvider>,
		);

		const output = lastFrame() || "";

		expect(
			output
				.split("\n")
				.some((line) => line.includes("Old") && line.includes("New")),
		).toBe(true);
	});

	it("keeps original whitespace in highlighted line parts before Ink layout", () => {
		expect(renderableCodeLineParts("\treturn 1;  ", "js")).toEqual({
			kind: "highlighted",
			leading: "\t",
			code: "return 1;",
			trailing: "  ",
		});
		expect(renderableCodeLineParts("\t\t", "js")).toEqual({
			kind: "plain",
			text: "\t\t",
		});
	});

	it("returns empty when search string is not in file content", () => {
		const fileText = "line 1\nline 2\nline 3\n";
		const oldText = "line 2\nline 2\n";

		const { lastFrame } = render(
			<DiffRenderer
				oldText={oldText}
				newText="line 1\nline 2\nline 3\n"
				filepath="/test.txt"
				fileContents={fileText}
			/>,
		);

		expect(lastFrame()).toBe("");
	});
});
