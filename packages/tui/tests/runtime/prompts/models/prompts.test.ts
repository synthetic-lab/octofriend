import { describe, expect, it } from "bun:test";
import {
	imageAttachmentPlaceholderText,
	toolSkip,
} from "../../../../src/runtime/prompts/models/main.ts";

describe("LLM IR prompt fragments", () => {
	it("renders skipped tool calls with the reason", () => {
		expect(toolSkip("read-only mode")).toBe(
			"Tool was skipped and didn't run. The reason for skipping the tool was:\nread-only mode",
		);
	});

	it("renders the unsupported-image placeholder text", () => {
		expect(imageAttachmentPlaceholderText()).toBe(
			"[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]",
		);
	});
});
