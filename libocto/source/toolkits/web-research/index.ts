import type { AgentToolkit } from "../../llm-ir.ts";
import { researcherAgent } from "./researcher-agent.ts";
import webResearchTool from "./web-research-tool.ts";

// A tool plus the subagent tree it delegates to, so clients compose the whole bundle with one
// `agent.use(toolkits.webResearch.toolkit)`.
export const toolkit = {
  tools: { "web-research": webResearchTool },
  agents: { researcher: researcherAgent },
} satisfies AgentToolkit;
