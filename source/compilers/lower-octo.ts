import type { octoAgent } from "../ir/octo-ir.ts";
import { defineLower } from "../libocto/define-lower.ts";
import type { LowerInputIR } from "../libocto/llm-ir.ts";
import { optimizeFiles } from "./optimize-files.ts";
import type { MultimodalConfig } from "../providers.ts";

export const lowerOctoToLlmIR = defineLower(
  (messages: Array<LowerInputIR<typeof octoAgent>>, modalities?: MultimodalConfig) =>
    optimizeFiles(messages, modalities),
);
