import type { ImageInfo } from "./images.ts";

export type ImageModalityConfig = {
  enabled: boolean;
  maxSizeMB: number;
  acceptedMimeTypes: string[];
};

export type MultimodalConfig = {
  image?: ImageModalityConfig;
};

export type CanDisplayImageResult = { ok: true } | { ok: false; reason: string };

export function canDisplayImage(
  modalities: MultimodalConfig | null,
  image: ImageInfo,
): CanDisplayImageResult {
  if (!modalities?.image?.enabled) {
    return { ok: false, reason: "Your model does not support image viewing." };
  }
  if (!modalities.image.acceptedMimeTypes.includes(image.mimeType)) {
    return {
      ok: false,
      reason: `Your model does not support ${image.mimeType} images. Supported formats: ${modalities.image.acceptedMimeTypes.join(", ")}.`,
    };
  }
  if (image.sizeBytes != null && image.sizeBytes > modalities.image.maxSizeMB * 1024 * 1024) {
    const sizeMB = (image.sizeBytes / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      reason: `Image file is too large (${sizeMB} MB). Maximum supported size is ${modalities.image.maxSizeMB} MB.`,
    };
  }
  return { ok: true };
}
