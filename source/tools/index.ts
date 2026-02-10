import { t } from "structural";
import toolMap from "./tool-defs/index.ts";
import { ToolDef, ToolResult, ToolError } from "./common.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
export { ToolError } from "./common.ts";

export type LoadedTools = {
  [K in keyof typeof toolMap]: Exclude<Awaited<ReturnType<(typeof toolMap)[K]>>, null>;
};
export type ToolCall = t.GetType<LoadedTools[keyof LoadedTools]["Schema"]>;

export async function loadTools(
  transport: Transport,
  signal: AbortSignal,
  config: Config,
): Promise<Partial<LoadedTools>> {
  const loaded: Partial<LoadedTools> = {};

  await Promise.all(
    (Object.keys(toolMap) as Array<keyof typeof toolMap>).map(async key => {
      const toolDef = await toolMap[key](signal, transport, config);
      if (toolDef) {
        // @ts-ignore
        loaded[key] = toolDef;
      }
    }),
  );

  return loaded as LoadedTools;
}

export const SKIP_CONFIRMATION: Array<keyof LoadedTools> = [
  "read",
  "list",
  "fetch",
  "skill",
  "web-search",
  "task", // Sub-agents run without confirmation
];

export async function runTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  call: ToolCall,
  config: Config,
  modelOverride: string | null,
): Promise<ToolResult> {
  const def = lookup(loaded, call);
  return await def.run(abortSignal, transport, call, config, modelOverride);
}

export async function validateTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  tool: ToolCall,
  config: Config,
): Promise<null | ToolError> {
  const toolDef = lookup(loaded, tool);
  return await toolDef.validate(abortSignal, transport, tool, config);
}

function lookup<T extends ToolCall>(loaded: Partial<LoadedTools>, t: T): ToolDef<T> {
  const def = loaded[t.name];
  if (def == null) throw new ToolError(`No tool named ${t.name}`);
  return def as ToolDef<T>;
}
