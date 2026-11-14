import toolMap from "../tools/tool-defs/index.ts";
import read from "../libocto/tools/read/index.ts";
import partialRead from "../libocto/tools/partial-read/index.ts";
import list from "../libocto/tools/list/index.ts";
import grep from "../libocto/tools/grep/index.ts";
import glob from "../libocto/tools/glob/index.ts";
import { definePermissionedAgent } from "../libocto/llm-ir.ts";
import type { AgentIR } from "../libocto/llm-ir.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { exploreSystemPrompt } from "../prompts/explore-system-prompt.ts";
import { researcherSystemPrompt } from "../prompts/researcher-system-prompt.ts";

// Raw web results stay in the researcher's context, not the primary agent's.
const { fetch, "web-search": webSearch, ...primaryTools } = toolMap;

export const octoAgent = definePermissionedAgent({
  systemPrompt,
  tools: primaryTools,
  agents: {
    explore: definePermissionedAgent({
      systemPrompt: exploreSystemPrompt,
      tools: { read, "partial-read": partialRead, list, grep, glob },
      agents: {},
    }),
    researcher: definePermissionedAgent({
      systemPrompt: researcherSystemPrompt,
      tools: { fetch, "web-search": webSearch },
      agents: {},
    }),
  },
});

export type OctoIR = AgentIR<typeof octoAgent>;
