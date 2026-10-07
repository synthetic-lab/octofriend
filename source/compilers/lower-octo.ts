import type { OctoIR, octoAgent } from "../ir/octo-ir.ts";
import type { Lower } from "../libocto/llm-ir.ts";
import { optimizeFiles } from "./optimize-files.ts";
import type { MultimodalConfig } from "../providers.ts";

export function lowerOctoToLlmIR(
  messages: OctoIR[],
  modalities?: MultimodalConfig,
): Array<Lower<typeof octoAgent>> {
  return optimizeFiles(messages, modalities);
}
