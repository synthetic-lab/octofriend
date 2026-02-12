import fs from "fs/promises";
import path from "path";
import { parse } from "shell-quote";

export type ImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/gif"
  | "image/svg+xml";

export type ImageInfo = {
  mimeType: ImageMimeType;
  base64Data: string;
  dataUrl: string;
  width?: number;
  height?: number;
  filePath?: string;
  loading?: boolean;
};

const IMAGE_EXTENSIONS: Record<string, ImageMimeType> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
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

export function parseImagePaths(input: string): string[] | null {
  const paths = parse(input);
  const imagePaths: string[] = [];
  for (const p of paths) {
    if (typeof p === "string" && isImagePath(p)) {
      imagePaths.push(p);
    } else {
      return null;
    }
  }
  return imagePaths;
}

export function getMimeTypeFromPath(filePath: string): ImageMimeType | null {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS[ext] || null;
}

export function getMimeTypeFromBase64DataUrl(dataUrl: string): ImageMimeType | null {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  if (!match) return null;
  const mimeType = match[1] as ImageMimeType;
  if (isValidImageMimeType(mimeType)) {
    return mimeType;
  }
  return null;
}

export function isValidImageMimeType(mimeType: string): mimeType is ImageMimeType {
  return Object.keys(IMAGE_EXTENSIONS).some(ext => IMAGE_EXTENSIONS[ext] === mimeType);
}

export async function readImageFile(filePath: string): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    throw new Error(`Failed to read image file ${filePath}: ${error}`);
  }
}

export function bufferToBase64(buffer: Buffer): string {
  return buffer.toString("base64");
}

export function createDataUrl(mimeType: ImageMimeType, base64Data: string): string {
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
  };
}

export function parseBase64Image(dataUrl: string): { mimeType: ImageMimeType; base64Data: string } {
  const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) {
    throw new Error("Invalid data URL format");
  }

  const mimeType = match[1] as ImageMimeType;
  if (!isValidImageMimeType(mimeType)) {
    throw new Error(`Unsupported image MIME type: ${mimeType}`);
  }

  return {
    mimeType,
    base64Data: match[2],
  };
}

export function extractImagePathsFromText(text: string): string[] {
  const imagePaths: string[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (isImagePath(trimmed)) {
      imagePaths.push(trimmed);
    }
  }

  return imagePaths;
}

export async function loadImagesFromPaths(imagePaths: string[]): Promise<ImageInfo[]> {
  const results = await Promise.allSettled(imagePaths.map(loadImageFromPath));

  return results
    .map((result, index) => ({ result, path: imagePaths[index] }))
    .filter(
      (item): item is { result: PromiseFulfilledResult<ImageInfo>; path: string } =>
        item.result.status === "fulfilled",
    )
    .map(item => item.result.value);
}

export type AnthropicImageMimeType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export function getMimeTypeFromDataUrl(dataUrl: string): AnthropicImageMimeType | undefined {
  const match = dataUrl.match(/^data:(image\/\w+);base64,/);
  if (!match) return undefined;
  const mimeType = match[1];
  const validTypes: AnthropicImageMimeType[] = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
  ];
  if (validTypes.includes(mimeType as AnthropicImageMimeType)) {
    return mimeType as AnthropicImageMimeType;
  }
  return undefined;
}

export function extractBase64FromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:image\/\w+;base64,(.+)$/);
  if (!match) return dataUrl;
  return match[1];
}
