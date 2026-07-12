import { describe, expect, it } from "bun:test";
import { Box } from "ink";
import { render } from "ink-testing-library";
import {
	ContentRenderer,
	countToolOutputTextLines,
	ImageContentRenderer,
	renderContentTextLines,
	summarizeToolOutputContent,
	ToolOutputContentRenderer,
	ToolOutputTextRenderer,
	toolOutputLineCountText,
} from "../../src/render/content.tsx";
import { countRenderedLines } from "../../src/render/lines.ts";

describe("terminal content rendering", () => {
	it("renders text content line by line", () => {
		const { lastFrame } = render(
			<ContentRenderer
				content={[{ type: "text", content: "first\nsecond" }]}
				textColor="gray"
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("first");
		expect(output).toContain("second");
	});

	it("preserves blank text lines", () => {
		const { lastFrame } = render(
			<ContentRenderer
				content={[{ type: "text", content: "first\n\nsecond" }]}
			/>,
		);

		const outputLines = (lastFrame() || "").split("\n");
		expect(outputLines).toEqual(["first", "", "second"]);
	});

	it("renders exported text-line helpers in one pass-compatible shape", () => {
		const { lastFrame } = render(
			<Box flexDirection="column">
				{renderContentTextLines("first\n\nsecond", 0)}
			</Box>,
		);

		expect((lastFrame() || "").split("\n")).toEqual(["first", "", "second"]);
	});

	it("does not add copyable filler spaces for boxed blank text lines", () => {
		const { lastFrame } = render(
			<Box flexDirection="column">
				{renderContentTextLines("first\n\nsecond", 0, undefined, true)}
			</Box>,
		);

		const output = lastFrame() || "";
		expect(output.split("\n")).toEqual(["first", "", "second"]);
		expect(output).not.toContain("first\n \nsecond");
	});

	it("renders CRLF and CR text content line by line", () => {
		const { lastFrame } = render(
			<ContentRenderer
				content={[{ type: "text", content: "first\r\nsecond\rthird\n" }]}
				textColor="gray"
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("first");
		expect(output).toContain("second");
		expect(output).toContain("third");
	});

	it("counts rendered text lines without allocating split arrays", () => {
		expect(countRenderedLines("")).toBe(1);
		expect(countRenderedLines("one\ntwo")).toBe(2);
		expect(countRenderedLines("one\r\ntwo\rthree\n")).toBe(4);
	});

	it("summarizes tool output content in one pass", () => {
		const image = {
			filePath: "diagram.png",
			mimeType: "image/png",
			sizeBytes: 2048,
			base64Data: "ZmFrZQ==",
			dataUrl: "data:image/png;base64,ZmFrZQ==",
		} as const;

		expect(
			summarizeToolOutputContent([
				{ type: "text", content: "one\ntwo" },
				{ type: "image", image },
				{ type: "text", content: "three" },
			]),
		).toEqual({ lineCount: 3, imageParts: [{ type: "image", image }] });
	});

	it("counts tool output text lines without collecting image parts", () => {
		expect(
			countToolOutputTextLines([
				{ type: "text", content: "one\r\ntwo" },
				{
					type: "image",
					image: {
						filePath: "ignored.jpg",
						mimeType: "image/jpeg",
						sizeBytes: 1024,
						base64Data: "ZmFrZQ==",
						dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
					},
				},
				{ type: "text", content: "three\r" },
				{ type: "text", content: "" },
			]),
		).toBe(3);
	});

	it("renders image attachment badges", () => {
		const { lastFrame } = render(
			<ImageContentRenderer
				image={{
					filePath: "diagram.png",
					mimeType: "image/png",
					sizeBytes: 2048,
					base64Data: "ZmFrZQ==",
					dataUrl: "data:image/png;base64,ZmFrZQ==",
				}}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("diagram.png");
		expect(output).toContain("2 KB");
	});

	it("formats singular and plural tool output line counts", () => {
		expect(toolOutputLineCountText(0)).toBe("Got 0 lines of output");
		expect(toolOutputLineCountText(1)).toBe("Got 1 line of output");
		expect(toolOutputLineCountText(2)).toBe("Got 2 lines of output");
	});

	it("summarizes text output lines and shows output images", () => {
		const { lastFrame } = render(
			<ToolOutputContentRenderer
				content={[
					{ type: "text", content: "one\ntwo" },
					{
						type: "image",
						image: {
							filePath: "result.jpg",
							mimeType: "image/jpeg",
							sizeBytes: 1024,
							base64Data: "ZmFrZQ==",
							dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
						},
					},
				]}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("Got 2 lines of output");
		expect(output).toContain("result.jpg");
	});

	it("shows text tool output only when expansion is requested", () => {
		const content = [
			{ type: "text" as const, content: "stdout first\r\nstdout second" },
		];
		const hidden = render(<ToolOutputContentRenderer content={content} />);
		const shown = render(
			<ToolOutputContentRenderer content={content} showText={true} />,
		);

		expect(hidden.lastFrame() || "").not.toContain("stdout first");
		expect(shown.lastFrame() || "").toContain("stdout first");
		expect(shown.lastFrame() || "").toContain("stdout second");
		expect(shown.lastFrame() || "").not.toContain("\r");
	});

	it("does not count a trailing line break as a phantom output line", () => {
		const { lastFrame } = render(
			<ToolOutputTextRenderer content={"one\ntwo\n"} />,
		);

		expect(lastFrame() || "").toContain("Got 2 lines of output");
	});

	it("renders direct text tool output without content part arrays", () => {
		const { lastFrame } = render(
			<ToolOutputTextRenderer
				content={"one\r\ntwo\rthree"}
				image={{
					filePath: "result.png",
					mimeType: "image/png",
					sizeBytes: 1536,
					base64Data: "ZmFrZQ==",
					dataUrl: "data:image/png;base64,ZmFrZQ==",
				}}
			/>,
		);

		const output = lastFrame() || "";
		expect(output).toContain("Got 3 lines of output");
		expect(output).toContain("result.png");
		expect(output).toContain("2 KB");
	});
});
