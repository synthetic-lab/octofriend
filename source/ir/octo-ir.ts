import toolMap from "../tools/tool-defs/index.ts";
import { definePermissionedAgent } from "../libocto/llm-ir.ts";
import type { AgentIR } from "../libocto/llm-ir.ts";

export const octoAgent = definePermissionedAgent({
  tools: toolMap,
  agents: {},
});

export type OctoIR = AgentIR<typeof octoAgent>;
