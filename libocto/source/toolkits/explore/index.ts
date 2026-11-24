import type { AgentToolkit } from "../../llm-ir.ts";
import { exploreAgent } from "./explore-agent.ts";
import exploreTool from "./explore-tool.ts";

// A tool plus the subagent tree it delegates to, so clients compose the whole bundle with one
// `agent.use(toolkits.explore.toolkit)`.
export const toolkit = {
  tools: { explore: exploreTool },
  agents: { explore: exploreAgent },
} satisfies AgentToolkit;
