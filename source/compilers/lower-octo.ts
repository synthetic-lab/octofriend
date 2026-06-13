import type { OctoIR, octoAgent } from "../ir/octo-ir.ts";
import { lower as lowerGeneric } from "../libocto/lower.ts";
import type { LoweredIR } from "../libocto/llm-ir.ts";
import { optimizeFiles } from "./optimize-files.ts";
import type { FileOptimizerInputIR } from "./optimize-files.ts";
import type { MultimodalConfig } from "../providers.ts";
import type toolMap from "../tools/tool-defs/index.ts";

export function lowerOcto(
  messages: OctoIR[],
  modalities?: MultimodalConfig,
): Array<LoweredIR<typeof toolMap>> {
  const rejectedMessages = lowerToolRejects(messages);
  const optimizedMessages = optimizeFiles(rejectedMessages, modalities);
  return lowerGeneric<typeof octoAgent>(optimizedMessages);
}

function lowerToolRejects(messages: OctoIR[]): FileOptimizerInputIR[] {
  return messages.map(ir => {
    if (ir.role === "tool-reject") {
      return {
        role: "tool-skip-output",
        toolCall: ir.toolCall,
        reason: "Tool call rejected by user.",
      };
    }

    return ir;
  });
}
