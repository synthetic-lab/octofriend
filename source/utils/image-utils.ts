import fs from "fs/promises";
import path from "path";
import type { PaintFile } from "paintcannon";

// NOTE: not every model will support all image mime types.
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export type ImageInfo = {
  mimeType: ImageMimeType;
  base64Data: string;
  dataUrl: string;
  filePath: string;
  sizeBytes: number;
};

const IMAGE_EXTENSIONS: Record<string, ImageMimeType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function isFilePath(input: string): boolean {
  const trimmed = input.trim();
  const parsed = path.parse(trimmed);
  return parsed.dir !== "" || parsed.ext !== "";
}

export function isImagePath(filePath: string): boolean {
  if (!isFilePath(filePath)) return false;
  const ext = path.extname(filePath).toLowerCase();
  return ext in IMAGE_EXTENSIONS;
}

export function getMimeTypeFromPath(filePath: string): ImageMimeType {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = IMAGE_EXTENSIONS[ext];
  if (!mimeType) {
    throw new Error(`Unsupported image format for file: ${filePath}`);
  }
  return mimeType;
}

async function readImageFile(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`Failed to read image file ${filePath}: ${error}`);
  }
}

function bufferToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

function createDataUrl(mimeType: ImageMimeType, base64Data: string): string {
  return `data:${mimeType};base64,${base64Data}`;
}

export async function loadImageFromPath(filePath: string): Promise<ImageInfo> {
  const mimeType = getMimeTypeFromPath(filePath);
  if (!mimeType) {
    throw new Error(`Unsupported image format for file: ${filePath}`);
  }

  const buffer = await readImageFile(filePath);
  const base64Data = bufferToBase64(buffer);
  const dataUrl = createDataUrl(mimeType, base64Data);

  return {
    mimeType,
    base64Data,
    dataUrl,
    filePath: path.resolve(filePath),
    sizeBytes: buffer.length,
  };
}

export async function loadImageFromPaintFile(file: PaintFile): Promise<ImageInfo> {
  if (!isSupportedImageMimeType(file.type)) {
    throw new Error(`Unsupported pasted image format: ${file.type}`);
  }
  const buffer = Buffer.from(await file.bytes());
  const base64Data = bufferToBase64(buffer);
  return {
    mimeType: file.type,
    base64Data,
    dataUrl: createDataUrl(file.type, base64Data),
    filePath: file.name,
    sizeBytes: file.size,
  };
}

const isSupportedImageMimeType = (mimeType: string): mimeType is ImageMimeType => {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
};

export function getMimeTypeFromDataUrl(dataUrl: string): ImageMimeType | undefined {
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
