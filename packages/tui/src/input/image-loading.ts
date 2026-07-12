import fs from "node:fs/promises";
import path from "node:path";
import { err, errorToString, ok, type Result } from "../shell/result.ts";
import {
	IMAGE_EXTENSIONS,
	type ImageInfo,
	type ImageMimeType,
	SUPPORTED_IMAGE_MIME_TYPES,
} from "./image-types.ts";

export function getMimeTypeFromPath(
	filePath: string,
): Result<ImageMimeType, string> {
	const ext = path.extname(filePath).toLowerCase();
	const mimeType = IMAGE_EXTENSIONS[ext];
	if (!mimeType) return err(`Unsupported image format for file: ${filePath}`);
	return ok(mimeType);
}

export async function loadImageFromPath(
	filePath: string,
): Promise<Result<ImageInfo, string>> {
	const mimeType = getMimeTypeFromPath(filePath);
	if (!mimeType.success) return mimeType;
	const buffer = await readImageFile(filePath);
	if (!buffer.success) return buffer;
	const base64Data = buffer.data.toString("base64");
	const dataUrl = `data:${mimeType.data};base64,${base64Data}`;

	return ok({
		mimeType: mimeType.data,
		base64Data,
		dataUrl,
		filePath: path.resolve(filePath),
		sizeBytes: buffer.data.length,
	});
}

export function getMimeTypeFromDataUrl(
	dataUrl: string,
): ImageMimeType | undefined {
	const marker = ";base64,";
	const idx = dataUrl.indexOf(marker);
	if (idx === -1) return undefined;
	const mimeType = dataUrl.slice("data:".length, idx);
	return isSupportedImageMimeType(mimeType) ? mimeType : undefined;
}

export function extractBase64FromDataUrl(dataUrl: string): string {
	const marker = ";base64,";
	const idx = dataUrl.indexOf(marker);
	if (idx === -1) return dataUrl;
	return dataUrl.slice(idx + marker.length);
}

async function readImageFile(
	filePath: string,
): Promise<Result<Buffer, string>> {
	try {
		return ok(await fs.readFile(filePath));
	} catch (error) {
		return err(
			`Failed to read image file ${filePath}: ${errorToString(error)}`,
		);
	}
}

function isSupportedImageMimeType(mimeType: string): mimeType is ImageMimeType {
	let index = 0;
	while (index < SUPPORTED_IMAGE_MIME_TYPES.length) {
		if (SUPPORTED_IMAGE_MIME_TYPES[index] === mimeType) return true;
		index += 1;
	}
	return false;
}
