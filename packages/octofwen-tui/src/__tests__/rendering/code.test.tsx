import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
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
