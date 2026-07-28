import type { octoAgent } from "../ir/octo-ir.ts";
import type { CheckpointedIRWithTrajectories } from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import * as irPrompts from "../prompts/octo-ir-prompts.ts";
import { canDisplayImage } from "../providers.ts";
import type { MultimodalConfig } from "../providers.ts";
import type { FileMutateIR, FileReadIR } from "../tools/common.ts";
import type toolMap from "../tools/tool-defs/index.ts";

type FileIR = FileReadIR<ToolCall<typeof toolMap>> | FileMutateIR<ToolCall<typeof toolMap>>;

export type FileOptimizerInputIR = CheckpointedIRWithTrajectories<typeof octoAgent> | FileIR;

export function optimizeFiles(
  messages: FileOptimizerInputIR[],
  modalities?: MultimodalConfig,
): Array<CheckpointedIRWithTrajectories<typeof octoAgent>> {
  const output: Array<CheckpointedIRWithTrajectories<typeof octoAgent>> = [];
  const seenPaths = new Set<string>();

  for (const ir of [...messages].reverse()) {
    output.push(optimizeFileIR(ir, seenPaths, modalities));
  }

  return output.reverse();
}

function optimizeFileIR(
  ir: FileOptimizerInputIR,
  seenPaths: Set<string>,
  modalities?: MultimodalConfig,
): CheckpointedIRWithTrajectories<typeof octoAgent> {
  if (ir.role === "file-read") {
    const seenPath = seenPaths.has(ir.path);
    seenPaths.add(ir.path);

    const imageCheck = ir.image ? canDisplayImage(modalities, ir.image) : null;
    if (ir.image && imageCheck?.ok) {
      /*
       * The read tool call must still be answered by a tool-output-shaped IR: converting it
       * into a user message would leave the assistant's tool call dangling, which Anthropic
       * hard-400s on (and is out-of-distribution for chat-completions models). Vision models
       * support images in tool outputs, so attach the image to the tool output directly.
       */
      return {
        role: "tool-output",
        toolCall: ir.toolCall,
        content: [
          { type: "text", content: irPrompts.fileRead(ir.content, seenPath, imageCheck) },
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
