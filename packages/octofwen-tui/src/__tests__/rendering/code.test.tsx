import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { TerminalSizeProvider } from "../../layout/viewport.tsx";
import { DiffRenderer, FileRenderer } from "../../rendering/code.tsx";

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
