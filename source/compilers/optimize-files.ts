import { defineLower } from "../libocto/define-lower.ts";
import type {
  CheckpointedIR,
  IRConversion,
  ToolRejectMessage,
  ToolSubagentInvoke,
} from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import * as irPrompts from "../prompts/octo-ir-prompts.ts";
import { canDisplayImage } from "../providers.ts";
import type { MultimodalConfig } from "../libocto/modalities.ts";
import type { FileMutateIR, FileReadIR } from "../tools/common.ts";

type Output<Subagent extends string> =
  | CheckpointedIR<any>
  | ToolRejectMessage<any>
  | ToolSubagentInvoke<any, Subagent>;

type Input<Subagent extends string> =
  | Output<Subagent>
  | FileReadIR<ToolCall<any>>
  | FileMutateIR<ToolCall<any>>;

export const optimizeFiles = defineLower(
  <Subagent extends string>(
    messages: Array<Input<Subagent>>,
    modalities: MultimodalConfig | null,
  ): Array<IRConversion<Input<Subagent>, Output<Subagent>>> => {
    const output: Array<IRConversion<Input<Subagent>, Output<Subagent>>> = [];
    const seenPaths = new Set<string>();

    for (const original of [...messages].reverse()) {
      output.push({ original, converted: optimizeFileIR(original, seenPaths, modalities) });
    }

    return output.reverse();
  },
);

function optimizeFileIR<Subagent extends string>(
  ir: Input<Subagent>,
  seenPaths: Set<string>,
  modalities: MultimodalConfig | null,
): Output<Subagent> {
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
