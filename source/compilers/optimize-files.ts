import type {
  Agent,
  Content,
  IRConversion,
  PermissionedBrand,
  ShallowLoweredIR,
} from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import * as irPrompts from "../prompts/octo-ir-prompts.ts";
import { canDisplayImage } from "../providers.ts";
import type { MultimodalConfig } from "../providers.ts";
import type { FileMutateIR, FileReadIR } from "../tools/common.ts";

export type FileOptimizerInputIR =
  | ShallowLoweredIR<Agent<any, any, any> & PermissionedBrand>
  | FileReadIR<ToolCall<any>>
  | FileMutateIR<ToolCall<any>>;

// Only file IRs are rewritten; every other input keeps its exact type. In particular, this
// does not widen child tool names or invocation names to those of an abstract agent.
type OptimizedFileIR<IR> = IR extends FileReadIR<infer Call> | FileMutateIR<infer Call>
  ? Content & { role: "tool-output"; toolCall: Call }
  : IR;

export function optimizeFiles<IR extends FileOptimizerInputIR>(
  messages: IR[],
  modalities?: MultimodalConfig,
): Array<IRConversion<IR, OptimizedFileIR<IR>>> {
  const output: Array<IRConversion<IR, OptimizedFileIR<IR>>> = [];
  const seenPaths = new Set<string>();

  for (const original of [...messages].reverse()) {
    output.push({ original, converted: optimizeFileIR(original, seenPaths, modalities) });
  }

  return output.reverse();
}

function optimizeFileIR<IR extends FileOptimizerInputIR>(
  ir: IR,
  seenPaths: Set<string>,
  modalities?: MultimodalConfig,
): OptimizedFileIR<IR>;
function optimizeFileIR(
  ir: FileOptimizerInputIR,
  seenPaths: Set<string>,
  modalities?: MultimodalConfig,
): ShallowLoweredIR<Agent<any, any, any> & PermissionedBrand> {
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
