import type { OctoIR, octoAgent } from "../ir/octo-ir.ts";
import { lower as lowerGeneric } from "../libocto/lower.ts";
import type { LoweredIR, PreLoweredIR } from "../libocto/llm-ir.ts";
import { optimizeFiles } from "./optimize-files.ts";
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
): Array<PreLoweredIR<typeof octoAgent>> {
  return optimizeFiles(messages, modalities);
}
