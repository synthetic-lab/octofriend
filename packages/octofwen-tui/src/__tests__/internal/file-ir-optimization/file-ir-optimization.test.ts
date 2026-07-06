import { describe, expect, it } from "bun:test";
import type { ImageInfo } from "../../../input/image_attachments.ts";
import {
	canDisplayImage,
	optimizeFiles,
} from "../../../internal/file-ir-optimization/main.ts";

type TestToolCall = {
	type: "tool-call";
	toolCallId: string;
	name: "read" | "rewrite";
	original: Record<string, unknown>;
	parsed: Record<string, unknown>;
};

type TestBaseMessage = {
	role: "user";
	content: Array<{ type: "text"; content: string }>;
};

function toolCall(id: string): TestToolCall {
	return {
		type: "tool-call",
		toolCallId: id,
		name: "read",
		original: { filePath: "/tmp/a.txt" },
		parsed: { filePath: "/tmp/a.txt" },
	};
}

function mutateToolCall(id: string): TestToolCall {
	return {
		type: "tool-call",
		toolCallId: id,
		name: "rewrite",
		original: { filePath: "/tmp/a.txt", text: "" },
		parsed: { filePath: "/tmp/a.txt", text: "", originalFileContents: "idk" },
	};
}

function pngImage(sizeBytes = 3): ImageInfo {
	return {
		mimeType: "image/png",
		base64Data: "abc",
		dataUrl: "data:image/png;base64,abc",
		filePath: "/tmp/a.png",
		sizeBytes,
	};
}

describe("optimizeFiles", () => {
	it("keeps the newest read for a path and strips older reads", () => {
		const messages = [
			{
				role: "file-read" as const,
				path: "/tmp/a.txt",
				content: "old contents",
				toolCall: toolCall("old"),
			},
			{
				role: "file-read" as const,
				path: "/tmp/a.txt",
				content: "new contents",
				toolCall: toolCall("new"),
			},
		];

		expect(optimizeFiles<TestBaseMessage, TestToolCall>(messages)).toEqual([
			{
				role: "tool-output",
				toolCall: toolCall("old"),
				content: [{ type: "text", content: "File was successfully read." }],
			},
			{
				role: "tool-output",
				toolCall: toolCall("new"),
				content: [{ type: "text", content: "new contents" }],
			},
		]);
	});

	it("turns displayable image reads into user messages with images", () => {
		const image = pngImage();

		expect(
			optimizeFiles<TestBaseMessage, TestToolCall>(
				[
					{
						role: "file-read",
						path: "/tmp/a.png",
						content: "image contents",
						image,
						toolCall: toolCall("image-read"),
					},
				],
				{
					image: {
						enabled: true,
						acceptedMimeTypes: ["image/png"],
						maxSizeMB: 1,
					},
				},
			),
		).toEqual([
			{
				role: "user",
				content: [
					{
						type: "text",
						content: "[Tool result for call image-read]: image contents",
					},
					{ type: "image", image },
				],
			},
		]);
	});

	it("keeps unreadable image contents as text with the display failure reason", () => {
		const image = pngImage(2 * 1024 * 1024);

		expect(
			optimizeFiles<TestBaseMessage, TestToolCall>(
				[
					{
						role: "file-read",
						path: "/tmp/a.png",
						content: "image contents",
						image,
						toolCall: toolCall("image-read"),
					},
				],
				{
					image: {
						enabled: true,
						acceptedMimeTypes: ["image/png"],
						maxSizeMB: 1,
					},
				},
			),
		).toEqual([
			{
				role: "tool-output",
				toolCall: toolCall("image-read"),
				content: [
					{
						type: "text",
						content:
							"image contents\n[An image file was read but could not be displayed: Image file is too large (2.0 MB). Maximum supported size is 1 MB. The image content has been omitted.]",
					},
				],
			},
		]);
	});

	it("rewrites file mutation to a base tool message", () => {
		expect(
			optimizeFiles<TestBaseMessage, TestToolCall>([
				{
					role: "file-mutate",
					path: "/tmp/a.txt",
					content: "raw mutate output",
					toolCall: mutateToolCall("mutate"),
				},
			]),
		).toEqual([
			{
				role: "tool-output",
				toolCall: mutateToolCall("mutate"),
				content: [
					{ type: "text", content: "/tmp/a.txt was updated successfully." },
				],
			},
		]);
	});
});

describe("canDisplayImage", () => {
	it("rejects unsupported image modality", () => {
		expect(canDisplayImage(undefined, pngImage())).toEqual({
			ok: false,
			reason: "Your model does not support image viewing.",
		});
	});

	it("rejects unsupported mime types", () => {
		expect(
			canDisplayImage(
				{
					image: {
						enabled: true,
						acceptedMimeTypes: ["image/jpeg"],
						maxSizeMB: 1,
					},
				},
				pngImage(),
			),
		).toEqual({
			ok: false,
			reason:
				"Your model does not support image/png images. Supported formats: image/jpeg.",
		});
	});

	it("accepts supported images within size limits", () => {
		expect(
			canDisplayImage(
				{
					image: {
						enabled: true,
						acceptedMimeTypes: ["image/png"],
						maxSizeMB: 1,
					},
				},
				pngImage(),
			),
		).toEqual({ ok: true });
	});
});
