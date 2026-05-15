import toolMap from "../tools/tool-defs/index.ts";
import { defineAgent } from "../libocto/llm-ir.ts";
import type { LlmIR } from "../libocto/llm-ir.ts";

export const octoAgent = defineAgent({
  tools: toolMap,
  agents: {},
});

export type OctoIR = LlmIR<typeof octoAgent>;
