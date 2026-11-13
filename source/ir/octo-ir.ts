import toolMap from "../tools/tool-defs/index.ts";
import { agent } from "../libocto/llm-ir.ts";
import type { AgentIR } from "../libocto/llm-ir.ts";
import { explore } from "../libocto/toolkits/explore/index.ts";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { researcherSystemPrompt } from "../prompts/researcher-system-prompt.ts";

// Raw web results stay in the researcher's context, not the primary agent's. The explore toolkit
// supplies both its invocation tool and its child agent.
const { fetch, "web-search": webSearch, explore: _exploreTool, ...primaryTools } = toolMap;

export const octoAgent = agent.use(explore).definePermissioned({
  systemPrompt,
  tools: primaryTools,
  agents: {
    researcher: agent.definePermissioned({
      systemPrompt: researcherSystemPrompt,
      tools: { fetch, "web-search": webSearch },
      agents: {},
    }),
  },
});

export type OctoIR = AgentIR<typeof octoAgent>;
