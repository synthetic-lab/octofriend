import { t } from "structural";

import { unionAll } from "../types.ts";
import * as toolMap from "./tool-defs/index.ts";
import { ToolDef, ToolResult } from "./common.ts";
import { SequenceIdTagged } from "../history.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";

export { ToolError } from "./common.ts";
export * from "./tool-defs/index.ts";

export const ALL_TOOLS = Object.values(toolMap).map(t => t.Schema);
export const ToolCallSchema = unionAll(ALL_TOOLS);

export const SKIP_CONFIRMATION: Array<t.GetType<typeof ToolCallSchema>["name"]> = [
  "read",
  "list",
  "fetch",
];

export async function runTool(
  abortSignal: AbortSignal,
  transport: Transport,
  call: SequenceIdTagged<{ tool: t.GetType<typeof ToolCallSchema> }>,
  config: Config,
  modelOverride: string | null,
): Promise<ToolResult> {
  const def = lookup(call.tool);
  return await def.run(abortSignal, transport, call, config, modelOverride);
}

export async function validateTool(
  abortSignal: AbortSignal,
  transport: Transport,
  tool: t.GetType<typeof ToolCallSchema>,
  config: Config,
): Promise<null> {
  const toolDef = lookup(tool);
  return await toolDef.validate(abortSignal, transport, tool, config);
}

function lookup<T extends t.GetType<typeof ToolCallSchema>>(t: T): ToolDef<T> {
  return toolMap[t.name] as ToolDef<T>;
}
