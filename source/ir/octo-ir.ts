import toolMap from "../tools/tool-defs/index.ts";
import { defineAgent } from "../libocto/llm-ir.ts";
import type { LlmIR } from "../libocto/llm-ir.ts";
import type { ToolCall } from "../libocto/tool-def.ts";

export const octoAgent = defineAgent({
  tools: toolMap,
  agents: {},
});

export type OctoToolRejectIR = {
  role: "tool-reject";
  toolCall: ToolCall<typeof toolMap>;
};

export type OctoIR = LlmIR<typeof octoAgent> | OctoToolRejectIR;
