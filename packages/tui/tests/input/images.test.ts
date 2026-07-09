import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	extractBase64FromDataUrl,
	getMimeTypeFromDataUrl,
	getMimeTypeFromPath,
	isImagePath,
	loadImageFromPath,
	parseImagePaths,
	replaceInputWithSafeCharacters,
	separateFilePaths,
} from "../../src/input/images";

type TestResult<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

function expectOk<T, E>(result: TestResult<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
}

describe("image path parsing", () => {
	it("separates regular-space-delimited paths while preserving non-breaking and thin spaces", () => {
		expect(separateFilePaths("/path/to/file.png")).toEqual([
			"/path/to/file.png",
		]);
		expect(separateFilePaths("/path/to/a.png /path/to/b.png")).toEqual([
			"/path/to/a.png",
			"/path/to/b.png",
		]);
		expect(separateFilePaths("/path/to/my\u00A0file.png /b.png")).toEqual([
			"/path/to/my\u00A0file.png",
			"/b.png",
		]);
		expect(separateFilePaths("/path/to/my\u2009file.png /b.png")).toEqual([
			"/path/to/my\u2009file.png",
			"/b.png",
		]);
		expect(separateFilePaths("/a.png /b.png /c.png")).toEqual([
			"/a.png",
			"/b.png",
			"/c.png",
		]);
		expect(separateFilePaths("/tmp/😀.png /b.png")).toEqual([
			"/tmp/😀.png",
			"/b.png",
		]);
	});

	it("keeps escaped spaces inside one path", () => {
		expect(separateFilePaths("/path/to/my\\ file.png /other.png")).toEqual([
			"/path/to/my\\ file.png",
			"/other.png",
		]);
	});

	it("separates newline-delimited paths without split allocation", () => {
		expect(separateFilePaths("/a.png\n/b.jpg\n")).toEqual(["/a.png", "/b.jpg"]);
	});

	it("separates paths across repeated spaces and CRLF without dropping characters", () => {
		expect(separateFilePaths("/a.png  /b.jpg")).toEqual(["/a.png", "/b.jpg"]);
		expect(separateFilePaths("/a.png\r\n/b.jpg")).toEqual(["/a.png", "/b.jpg"]);
		expect(parseImagePaths("/a.png\r\n/b.jpg")).toEqual(["/a.png", "/b.jpg"]);
	});

	it("replaces non-separator characters with placeholders for safe shell parsing", () => {
		expect(replaceInputWithSafeCharacters("/a b\\ c\n/d")).toBe("__ ____\n__");
	});

	it("parses and sanitizes valid image paths", () => {
		expect(parseImagePaths("/path/to/file.png")).toEqual(["/path/to/file.png"]);
		expect(parseImagePaths("/a.png /b.jpg")).toEqual(["/a.png", "/b.jpg"]);
		expect(parseImagePaths("/a.jpeg /b.webp /c.gif")).toEqual([
			"/a.jpeg",
			"/b.webp",
			"/c.gif",
		]);
		expect(parseImagePaths("'/path/to/file.png'")).toEqual([
			"/path/to/file.png",
		]);
		expect(parseImagePaths('"/path/to/file.png"')).toEqual([
			"/path/to/file.png",
		]);
		expect(parseImagePaths('"/path/to/my file.png"')).toEqual([
			"/path/to/my file.png",
		]);
		expect(parseImagePaths("/path/to/my\\ file.png")).toEqual([
			"/path/to/my file.png",
		]);
		expect(parseImagePaths("/path/to/file\\(1\\).png")).toEqual([
			"/path/to/file(1).png",
		]);
	});

	it("returns null when any parsed path is not an image path", () => {
		expect(parseImagePaths("/path/to/file.txt")).toBeNull();
		expect(parseImagePaths("/a.png /b.txt")).toBeNull();
		expect(parseImagePaths("not-an-image")).toBeNull();
	});
});

describe("image MIME helpers", () => {
	it("detects supported image paths and MIME types", () => {
		expect(isImagePath(" \t/tmp/a.png\n")).toBe(true);
		expect(isImagePath("/tmp/a.png")).toBe(true);
		expect(isImagePath("/tmp/a.PNG")).toBe(true);
		expect(isImagePath("/tmp/a.txt")).toBe(false);
		expect(isImagePath("plain-name")).toBe(false);
		expect(expectOk(getMimeTypeFromPath("/tmp/a.png"))).toBe("image/png");
		expect(expectOk(getMimeTypeFromPath("/tmp/a.jpg"))).toBe("image/jpeg");
		expect(expectOk(getMimeTypeFromPath("/tmp/a.jpeg"))).toBe("image/jpeg");
		expect(expectOk(getMimeTypeFromPath("/tmp/a.webp"))).toBe("image/webp");
		expect(expectOk(getMimeTypeFromPath("/tmp/a.gif"))).toBe("image/gif");
		const unsupported = getMimeTypeFromPath("/tmp/a.txt");
		expect(unsupported.success).toBe(false);
		if (!unsupported.success) {
			expect(unsupported.error).toContain("Unsupported image format");
		}
	});

	it("extracts MIME type and base64 data from data URLs", () => {
		expect(getMimeTypeFromDataUrl("data:image/png;base64,abc123")).toBe(
			"image/png",
		);
		expect(
			getMimeTypeFromDataUrl("data:text/plain;base64,abc123"),
		).toBeUndefined();
		expect(getMimeTypeFromDataUrl("abc123")).toBeUndefined();
		expect(extractBase64FromDataUrl("data:image/png;base64,abc123")).toBe(
			"abc123",
		);
		expect(extractBase64FromDataUrl("abc123")).toBe("abc123");
	});
});

describe("loadImageFromPath", () => {
	it("loads an image as base64 and a data URL", async () => {
		const directory = await mkdtemp(path.join(os.tmpdir(), "octofwen-image-"));
		const imagePath = path.join(directory, "tiny.png");
		await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

		const image = expectOk(await loadImageFromPath(imagePath));

		expect(image).toEqual({
			mimeType: "image/png",
			base64Data: "iVBORw==",
			dataUrl: "data:image/png;base64,iVBORw==",
			filePath: path.resolve(imagePath),
			sizeBytes: 4,
		});
	});

	it("reports read failures with the path", async () => {
		const result = await loadImageFromPath("/missing/image.png");
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toContain(
				"Failed to read image file /missing/image.png",
			);
		}
	});
});
