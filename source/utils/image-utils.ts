import fs from "fs/promises";
import path from "path";
import { parse } from "shell-quote";
import { parseArgsStringToArgv } from "string-argv";

const CHARACTER_PLACEHOLDER = "_";

// NOTE: not every model will support all image mime types.
const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export type ImageInfo = {
  mimeType: ImageMimeType;
  base64Data: string;
  dataUrl: string;
  filePath?: string;
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

// Replaces every character with a placeholder character except for spaces that are not escaped, which are used to separate file paths.
export function replaceInputWithSafeCharacters(input: string): string {
  let escaped = false;
  let sanitized = "";
  for (const char of input) {
    if (char === "\\") {
      escaped = !escaped;
      sanitized += CHARACTER_PLACEHOLDER;
    } else if (char === " " && !escaped) {
      sanitized += " ";
      escaped = false;
    } else {
      sanitized += CHARACTER_PLACEHOLDER;
      escaped = false;
    }
  }
  return sanitized;
}

export function separateFilePaths(input: string): string[] {
  const placeholderInput = replaceInputWithSafeCharacters(input);
  const parsedPlaceholderInput = parse(placeholderInput);
  const filePaths: string[] = [];
  let cursor = 0;
  for (const separatedPlaceholderPath of parsedPlaceholderInput) {
    if (typeof separatedPlaceholderPath == "string") {
      filePaths.push(input.slice(cursor, cursor + separatedPlaceholderPath.length));
      cursor += separatedPlaceholderPath.length + 1;
    }
  }
  return filePaths;
}

function sanitizeFilePath(path: string): string {
  // 1. Strip wrapping quotes (Single or Double)
  // Terminals often wrap paths in quotes instead of escaping them.
  let cleanPath = path.replace(/^['"]|['"]$/g, "");

  // 2. Unescape all shell-escaped characters
  // This looks for a backslash followed by ANY character, and replaces it
  // with just that character.
  // e.g., "\ " -> " ", "\(" -> "(", "\\" -> "\"
  cleanPath = cleanPath.replace(/\\(.)/g, "$1");
  return cleanPath;
}

export function parseImagePaths(input: string): string[] | null {
  const filePaths = separateFilePaths(input);
  const sanitizedFilePaths = filePaths.map(path => sanitizeFilePath(path));
  const imagePaths: string[] = [];
  for (const path of sanitizedFilePaths) {
    if (typeof path === "string" && isImagePath(path)) {
      imagePaths.push(path);
    } else {
      return null;
    }
  }
  return imagePaths;
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
