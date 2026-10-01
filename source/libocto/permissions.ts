import type { Agent } from "./llm-ir.ts";
import type { ToolCall } from "./tool-def.ts";

export type PermissionDecision = { decision: "allow" } | { decision: "reject"; steering: string };

export type PermissionGate<A extends Agent<any, any, any>> = (
  toolCall: ToolCall<A["tools"]>,
) => Promise<PermissionDecision>;
