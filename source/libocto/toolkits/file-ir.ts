import type { ImageInfo } from "../images.ts";
import type { Content, IRConversion } from "../llm-ir.ts";
import type { BuiltinIRRole } from "../ir-roles.ts";
import {
  canDisplayImage,
  type CanDisplayImageResult,
  type MultimodalConfig,
} from "../modalities.ts";
import type { ToolCall } from "./tool-def.ts";

export type FileReadIR<T extends ToolCall<any>> = {
  role: "file-read";
  content: string;
  toolCall: T;
  path: string;
  image?: ImageInfo;
};

export type FileMutateIR<T extends ToolCall<any>> = {
  role: "file-mutate";
  content: string;
  toolCall: T;
  path: string;
};

export function fileReadIR<T extends ToolCall<any> & { parsed: { filePath: string } }>(
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

export function fileMutateIR<T extends ToolCall<any> & { parsed: { filePath: string } }>(
  toolCall: T,
) {
  return (args: { content: string }): FileMutateIR<T> => ({
    role: "file-mutate",
    content: args.content,
    toolCall,
    path: toolCall.parsed.filePath,
  });
}

function fileReadContent(
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

type FileOutput<Call extends ToolCall<any>> = Content & { role: "tool-output"; toolCall: Call };

// Preserve the client's provenance while lowering file extras in each contiguous history run.
export function lowerFileExtras<
  Original,
  Converted extends { role: BuiltinIRRole },
  Call extends ToolCall<any>,
>(
  messages: Array<IRConversion<Original, Converted | FileReadIR<Call> | FileMutateIR<Call>>>,
  modalities: MultimodalConfig | null,
): Array<IRConversion<Original, Converted | FileOutput<Call>>> {
  const output: Array<IRConversion<Original, Converted | FileOutput<Call>>> = [];
  const seenPaths = new Set<string>();

  for (const { original, converted: ir } of [...messages].reverse()) {
    if (ir.role === "file-read") {
      const seenPath = seenPaths.has(ir.path);
      seenPaths.add(ir.path);
      const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
      const content = [
        { type: "text" as const, content: fileReadContent(ir.content, seenPath, imageCheck) },
        ...(ir.image && imageCheck?.ok ? [{ type: "image" as const, image: ir.image }] : []),
      ];
      output.push({
        original,
        converted: { role: "tool-output", toolCall: ir.toolCall, content },
      });
    } else if (ir.role === "file-mutate") {
      output.push({
        original,
        converted: {
          role: "tool-output",
          toolCall: ir.toolCall,
          content: [{ type: "text", content: `${ir.path} was updated successfully.` }],
        },
      });
    } else {
      output.push({ original, converted: ir });
    }
  }

  return output.reverse();
}
