import type { octoAgent, OctoIR } from "../ir/octo-ir.ts";
import type { LoweredIRWithTrajectories } from "../libocto/llm-ir.ts";
import * as irPrompts from "../prompts/ir-prompts.ts";
import { canDisplayImage } from "../providers.ts";
import type { MultimodalConfig } from "../providers.ts";

export function optimizeFiles(
  messages: OctoIR[],
  modalities?: MultimodalConfig,
): Array<LoweredIRWithTrajectories<typeof octoAgent>> {
  const output: Array<LoweredIRWithTrajectories<typeof octoAgent>> = [];
  const seenPaths = new Set<string>();

  for (const ir of [...messages].reverse()) {
    output.push(optimizeFileIR(ir, seenPaths, modalities));
  }

  return output.reverse();
}

function optimizeFileIR(
  ir: OctoIR,
  seenPaths: Set<string>,
  modalities?: MultimodalConfig,
): LoweredIRWithTrajectories<typeof octoAgent> {
  if (ir.role === "file-read") {
    const seenPath = seenPaths.has(ir.path);
    seenPaths.add(ir.path);

    const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
    if (ir.image && imageCheck?.ok) {
      return {
        role: "user",
        content: [
          {
            type: "text",
            content: `[Tool result for call ${ir.toolCall.toolCallId}]: ${ir.content}`,
          },
          { type: "image", image: ir.image },
        ],
      };
    }

    return {
      role: "tool-output",
      toolCall: ir.toolCall,
      content: [{ type: "text", content: irPrompts.fileRead(ir.content, seenPath, imageCheck) }],
    };
  }

  if (ir.role === "file-mutate") {
    return {
      role: "tool-output",
      toolCall: ir.toolCall,
      content: [{ type: "text", content: irPrompts.fileMutation(ir.path) }],
    };
  }

  return ir;
}
