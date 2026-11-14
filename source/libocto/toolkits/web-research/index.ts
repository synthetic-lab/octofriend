import type { AgentToolkit } from "../../llm-ir.ts";
import { researcherAgent } from "./researcher-agent.ts";
import webResearchTool from "./web-research-tool.ts";

export const webResearch = {
  tools: { "web-research": webResearchTool },
  agents: { researcher: researcherAgent },
} satisfies AgentToolkit;
