import type { ImageInfo } from "../images.ts";
import type { Content, IRConversion } from "../llm-ir.ts";
import type { BuiltinIRRole } from "../ir-roles.ts";
import { canDisplayImage, type MultimodalConfig } from "../modalities.ts";
import type { ToolCallFromToolMap } from "./tool-def.ts";

export type FileReadIR<T extends ToolCallFromToolMap<any>> = {
  role: "file-read";
  content: string;
  toolCall: T;
  path: string;
  image?: ImageInfo;
};

export type FileMutateIR<T extends ToolCallFromToolMap<any>> = {
  role: "file-mutate";
  content: string;
  toolCall: T;
  path: string;
};

export function fileReadIR<T extends ToolCallFromToolMap<any> & { parsed: { filePath: string } }>(
  toolCall: T,
) {
  return (args: { content: string; image?: ImageInfo }): FileReadIR<T> => ({
    role: "file-read",
    content: args.content,
    toolCall,
    path: toolCall.parsed.filePath,
    image: args.image,
  });
}

export function fileMutateIR<T extends ToolCallFromToolMap<any> & { parsed: { filePath: string } }>(
  toolCall: T,
) {
  return (args: { content: string }): FileMutateIR<T> => ({
    role: "file-mutate",
    content: args.content,
    toolCall,
    path: toolCall.parsed.filePath,
  });
}

type FileOutput<Call extends ToolCallFromToolMap<any>> = Content & {
  role: "tool-output";
  toolCall: Call;
};

// Preserve the client's provenance while lowering file extras in each contiguous history run.
export function lowerFileExtras<
  Original,
  Converted extends { role: BuiltinIRRole },
  Call extends ToolCallFromToolMap<any>,
>(
  messages: Array<IRConversion<Original, Converted | FileReadIR<Call> | FileMutateIR<Call>>>,
  modalities: MultimodalConfig | null,
): Array<IRConversion<Original, Converted | FileOutput<Call>>> {
  // Lower each read independently: changing an earlier tool result on a later turn can
  // invalidate the provider's cached prefix and encrypted reasoning that follows it.
  return messages.map(({ original, converted: ir }) => {
    if (ir.role === "file-read") {
      const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
      const text =
        imageCheck && !imageCheck.ok
          ? `${ir.content}\n[An image file was read but could not be displayed: ${imageCheck.reason} The image content has been omitted.]`
          : ir.content;
      return {
        original,
        converted: {
          role: "tool-output",
          toolCall: ir.toolCall,
          content: [
            { type: "text", content: text },
            ...(ir.image && imageCheck?.ok ? [{ type: "image" as const, image: ir.image }] : []),
          ],
        },
      };
    }
    if (ir.role === "file-mutate") {
      return {
        original,
        converted: {
          role: "tool-output",
          toolCall: ir.toolCall,
          content: [{ type: "text", content: `${ir.path} was updated successfully.` }],
        },
      };
    }
    return { original, converted: ir };
  });
}
