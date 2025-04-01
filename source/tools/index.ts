import { t } from "structural";

import * as toolMap from "./tool-listing.ts";
import { ToolResult } from "./common.ts";

export { ToolError, ToolResult } from "./common.ts";
export * from "./tool-listing.ts";

export const ALL_TOOLS = Object.values(toolMap).map(t => t.Schema);

function unionAll<T extends t.Type<any>>(array: readonly T[]): t.Type<t.GetType<T>> {
  if(array.length === 1) return array[0];
  return array[0].or(unionAll(array.slice(1)));
}

export const ToolCallSchema = unionAll(ALL_TOOLS);

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

type ToolDef<T> = {
  Schema: t.Type<T>,
  validate: (t: T) => Promise<null>,
  run: (t: T) => Promise<ToolResult>,
};

function lookup<T extends t.GetType<typeof ToolCallSchema>>(t: T): ToolDef<T> {
  return toolMap[t.name] as ToolDef<T>;
}
