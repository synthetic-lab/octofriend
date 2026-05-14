import type {
  FileMutateMethod,
  FileOutdatedMessage,
  FileReadMessage,
  FileUnreadableMessage,
  LlmIR,
} from "../ir/llm-ir.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";
import { canDisplayImage } from "../providers.ts";
import type { MultimodalConfig } from "../providers.ts";

type FileIR = FileReadMessage | FileMutateMethod | FileOutdatedMessage | FileUnreadableMessage;

export type FileOptimizedLlmIR = Exclude<LlmIR, FileIR>;

export function optimizeFiles(
  messages: LlmIR[],
  modalities?: MultimodalConfig,
): FileOptimizedLlmIR[] {
  const output: FileOptimizedLlmIR[] = [];
  const seenPaths = new Set<string>();

  for (const ir of [...messages].reverse()) {
    output.push(optimizeFileIR(ir, seenPaths, modalities));
  }

  return output.reverse();
}

function optimizeFileIR(
  ir: LlmIR,
  seenPaths: Set<string>,
  modalities?: MultimodalConfig,
): FileOptimizedLlmIR {
  if (ir.role === "file-read") {
    const seenPath = seenPaths.has(ir.path);
    seenPaths.add(ir.path);

    const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
    if (ir.image && imageCheck?.ok) {
      return {
        role: "user",
        content: `[Tool result for call ${ir.toolCall.toolCallId}]: ${ir.content}`,
        images: [ir.image],
      };
    }

    return {
      role: "tool-output",
      toolCall: ir.toolCall,
      content: irPrompts.fileRead(ir.content, seenPath, imageCheck),
    };
  }

  if (ir.role === "file-mutate") {
    return {
      role: "tool-output",
      toolCall: ir.toolCall,
      content: irPrompts.fileMutation(ir.path),
    };
  }

  if (ir.role === "file-outdated" || ir.role === "file-unreadable") {
    return {
      role: "tool-error",
      toolCall: ir.toolCall,
      error: ir.error,
    };
  }

  return ir;
}
