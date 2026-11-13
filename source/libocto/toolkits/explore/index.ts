import type { AgentToolkit } from "../../llm-ir.ts";
import { exploreAgent } from "./explore-agent.ts";
import exploreTool from "./explore-tool.ts";

export const explore = {
  tools: { explore: exploreTool },
  agents: { explore: exploreAgent },
} satisfies AgentToolkit;
