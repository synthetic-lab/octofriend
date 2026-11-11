import { ImageInfo } from "../libocto/images.ts";
import { imageAttachmentPlaceholderText } from "../libocto/compilers/ir-prompts.ts";

export function toolReject() {
  return `
Tool call was rejected by user. Your tool call did not run. No changes were applied.
`.trim();
}

export function imageAttachmentPlaceholder(content: string, images: ImageInfo[]) {
  if (images.length === 0) return content;
  const imageBlurbs = images.map(() => imageAttachmentPlaceholderText()).join("\n");
  return `${imageBlurbs}\n\n${content}`;
}
