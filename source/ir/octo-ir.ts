import toolMap from "../tools/tool-defs/index.ts";
import read from "../libocto/toolkits/read/index.ts";
import partialRead from "../libocto/toolkits/partial-read/index.ts";
import list from "../libocto/toolkits/list/index.ts";
import grep from "../libocto/toolkits/grep/index.ts";
import glob from "../libocto/toolkits/glob/index.ts";
import { agent } from "../libocto/llm-ir.ts";
import type { AgentIR } from "../libocto/llm-ir.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { exploreSystemPrompt } from "../prompts/explore-system-prompt.ts";
import { researcherSystemPrompt } from "../prompts/researcher-system-prompt.ts";

// Raw web results stay in the researcher's context, not the primary agent's.
const { fetch, "web-search": webSearch, ...primaryTools } = toolMap;

export const octoAgent = agent.definePermissioned({
  systemPrompt,
  tools: primaryTools,
  agents: {
    explore: agent.definePermissioned({
      systemPrompt: exploreSystemPrompt,
      tools: { read, "partial-read": partialRead, list, grep, glob },
      agents: {},
    }),
    researcher: agent.definePermissioned({
      systemPrompt: researcherSystemPrompt,
      tools: { fetch, "web-search": webSearch },
      agents: {},
    }),
  },
});

export type OctoIR = AgentIR<typeof octoAgent>;
