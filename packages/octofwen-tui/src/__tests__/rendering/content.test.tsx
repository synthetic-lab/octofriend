import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import {
	ContentRenderer,
	ImageContentRenderer,
	ToolOutputContentRenderer,
} from "../../rendering/content.tsx";

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
});
