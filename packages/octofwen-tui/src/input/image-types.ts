const IMAGE_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export type ImageInfo = {
	mimeType: ImageMimeType;
	base64Data: string;
	dataUrl: string;
	filePath: string;
	sizeBytes: number;
};

export const SUPPORTED_IMAGE_MIME_TYPES: readonly ImageMimeType[] =
	IMAGE_MIME_TYPES;

export const IMAGE_EXTENSIONS: Record<string, ImageMimeType> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
};
