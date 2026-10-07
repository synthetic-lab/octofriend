import type { Agent, IRConversion, ShallowLoweredIR } from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import * as irPrompts from "../prompts/octo-ir-prompts.ts";
import { canDisplayImage } from "../providers.ts";
import type { MultimodalConfig } from "../providers.ts";
import type { FileMutateIR, FileReadIR } from "../tools/common.ts";

export type FileOptimizerInputIR<A extends Agent<any, any, any>> =
  | ShallowLoweredIR<A>
  | FileReadIR<ToolCall<A["tools"]>>
  | FileMutateIR<ToolCall<A["tools"]>>;

export function optimizeFiles<
  A extends Agent<any, any, any>,
  OriginalIR extends FileOptimizerInputIR<A>,
>(
  messages: OriginalIR[],
  modalities?: MultimodalConfig,
): Array<IRConversion<OriginalIR, ShallowLoweredIR<A>>> {
  const output: Array<IRConversion<OriginalIR, ShallowLoweredIR<A>>> = [];
  const seenPaths = new Set<string>();

  for (const original of [...messages].reverse()) {
    output.push({ original, converted: optimizeFileIR<A>(original, seenPaths, modalities) });
  }

  return output.reverse();
}

function optimizeFileIR<A extends Agent<any, any, any>>(
  ir: FileOptimizerInputIR<A>,
  seenPaths: Set<string>,
  modalities?: MultimodalConfig,
): ShallowLoweredIR<A> {
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
