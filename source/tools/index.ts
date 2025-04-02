import { t } from "structural";

import { unionAll } from "../types.ts";
import * as toolMap from "./tool-defs/index.ts";
import { ToolResult, ToolDef } from "./common.ts";

export { ToolError, ToolResult } from "./common.ts";
export * from "./tool-defs/index.ts";

export const ALL_TOOLS = Object.values(toolMap).map(t => t.Schema);
export const ToolCallSchema = unionAll(ALL_TOOLS);

// Filter out hidden tools for instructions
export const VISIBLE_TOOLS = Object.entries(toolMap)
  .filter(([_, tool]) => !("hidden" in tool && tool.hidden))
  .map(([key, tool]) => ({ name: key, schema: tool.Schema }));

export const SKIP_CONFIRMATION: Array<t.GetType<typeof ToolCallSchema>["name"]> = [
  "read",
  "list",
];

export async function runTool(tool: t.GetType<typeof ToolCallSchema>): Promise<ToolResult> {
  const def = lookup(tool);
  return await def.run(tool);
}

export async function validateTool(tool: t.GetType<typeof ToolCallSchema>): Promise<null> {
  const toolDef = lookup(tool);
  return await toolDef.validate(tool);
}

function lookup<T extends t.GetType<typeof ToolCallSchema>>(t: T): ToolDef<T> {
  return toolMap[t.name] as ToolDef<T>;
}
