import type { octoAgent } from "../ir/octo-ir.ts";
import type { Lower, TreeIR } from "../libocto/llm-ir.ts";
import { optimizeFiles } from "./optimize-files.ts";
import type { MultimodalConfig } from "../providers.ts";

export function lowerOctoToLlmIR(
  messages: Array<TreeIR<typeof octoAgent>>,
  modalities?: MultimodalConfig,
): Array<Lower<typeof octoAgent>> {
  return optimizeFiles(messages, modalities);
}
