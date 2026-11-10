import type { PaintFile } from "paintcannon";
import { createDataUrl, isSupportedImageMimeType, type ImageInfo } from "../libocto/images.ts";

export async function loadImageFromPaintFile(file: PaintFile): Promise<ImageInfo> {
  if (!isSupportedImageMimeType(file.type)) {
    throw new Error(`Unsupported pasted image format: ${file.type}`);
  }
  const buffer = Buffer.from(await file.bytes());
  const base64Data = buffer.toString("base64");
  return {
    mimeType: file.type,
    base64Data,
    dataUrl: createDataUrl(file.type, base64Data),
    filePath: file.name,
    sizeBytes: file.size,
  };
}
