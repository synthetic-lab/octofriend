import { ImageInfo } from "../utils/image-utils.ts";
import { CanDisplayImageResult } from "../providers.ts";
import { imageAttachmentPlaceholderText } from "../libocto/compilers/ir-prompts.ts";

export function toolReject() {
  return `
Tool call was rejected by user. Your tool call did not run. No changes were applied.
`.trim();
}

export function fileMutation(filePath: string) {
  return `${filePath} was updated successfully.`;
}

export function fileRead(
  content: string,
  seenPath: boolean,
  imageCheck?: CanDisplayImageResult | null,
) {
  if (imageCheck && !imageCheck.ok) {
    return `${content}\n[An image file was read but could not be displayed: ${imageCheck.reason} The image content has been omitted.]`;
  }
  if (seenPath) return "File was successfully read.";
  return content;
}

export function imageAttachmentPlaceholder(content: string, images: ImageInfo[]) {
  if (images.length === 0) return content;
  const imageBlurbs = images.map(() => imageAttachmentPlaceholderText()).join("\n");
  return `${imageBlurbs}\n\n${content}`;
}
