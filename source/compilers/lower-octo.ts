import type { OctoIR, octoAgent } from "../ir/octo-ir.ts";
import { lower as lowerGeneric } from "../libocto/lower.ts";
import type { CheckpointedIRWithTrajectories, LoweredIR } from "../libocto/llm-ir.ts";
import { optimizeFiles } from "./optimize-files.ts";
import type { FileOptimizerInputIR } from "./optimize-files.ts";
import type { MultimodalConfig } from "../providers.ts";
import type toolMap from "../tools/tool-defs/index.ts";

export function lowerOcto(
  messages: OctoIR[],
  modalities?: MultimodalConfig,
): Array<LoweredIR<typeof toolMap>> {
  return lowerGeneric<typeof octoAgent>(lowerOctoToLlmIR(messages, modalities));
}

export function lowerOctoToLlmIR(
  messages: OctoIR[],
  modalities?: MultimodalConfig,
): Array<CheckpointedIRWithTrajectories<typeof octoAgent>> {
  const rejectedMessages = lowerToolRejects(messages);
  return optimizeFiles(rejectedMessages, modalities);
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
