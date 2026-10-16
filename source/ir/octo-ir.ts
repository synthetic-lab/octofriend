import toolMap from "../tools/tool-defs/index.ts";
import read from "../tools/tool-defs/read.ts";
import partialRead from "../tools/tool-defs/partial-read.ts";
import list from "../tools/tool-defs/list.ts";
import grep from "../tools/tool-defs/grep.ts";
import glob from "../tools/tool-defs/glob.ts";
import { definePermissionedAgent } from "../libocto/llm-ir.ts";
import type { AgentIR } from "../libocto/llm-ir.ts";

export const octoAgent = definePermissionedAgent({
  tools: toolMap,
  agents: {
    explore: definePermissionedAgent({
      tools: { read, "partial-read": partialRead, list, grep, glob },
      agents: {},
    }),
  },
});

export type OctoIR = AgentIR<typeof octoAgent>;
