import { t } from "structural";

import { unionAll } from "../types.ts";
import * as toolMap from "./tool-defs/index.ts";
import { ToolDef } from "./common.ts";
import { SequenceIdTagged } from "../history.ts";
import { ContextSpace } from "../context-space.ts";
import { Config } from "../config.ts";

export { ToolError } from "./common.ts";
export * from "./tool-defs/index.ts";

export const ALL_TOOLS = Object.values(toolMap).map(t => t.Schema);
export const ToolCallSchema = unionAll(ALL_TOOLS);

export const SKIP_CONFIRMATION: Array<t.GetType<typeof ToolCallSchema>["name"]> = [
  "read",
  "list",
];

export async function runTool(
  call: SequenceIdTagged<{ tool: t.GetType<typeof ToolCallSchema> }>,
  context: ContextSpace,
  config: Config,
): Promise<string> {
  const def = lookup(call.tool);
  return await def.run(call, context, config);
}

export async function validateTool(
  tool: t.GetType<typeof ToolCallSchema>,
  config: Config,
): Promise<null> {
  const toolDef = lookup(tool);
  return await toolDef.validate(tool, config);
}

function lookup<T extends t.GetType<typeof ToolCallSchema>>(t: T): ToolDef<T> {
  return toolMap[t.name] as ToolDef<T>;
}
