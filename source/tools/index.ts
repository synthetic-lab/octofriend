import { t } from "structural";
import toolMap from "./tool-defs/index.ts";
import { ToolDef, ToolResult, ToolError } from "./common.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import * as logger from "../logger.ts";
export { ToolError } from "./common.ts";

export type LoadedTools = {
  [K in keyof typeof toolMap]: Exclude<Awaited<ReturnType<(typeof toolMap)[K]>>, null>;
};
export type ToolCall = t.GetType<LoadedTools[keyof LoadedTools]["Schema"]>;

export async function loadTools(
  transport: Transport,
  signal: AbortSignal,
  config: Config,
  allowedTools?: ReadonlyArray<keyof LoadedTools>,
  planFilePath: string | null = null,
): Promise<Partial<LoadedTools>> {
  const loaded: Partial<LoadedTools> = {};

  await Promise.all(
    (Object.keys(toolMap) as Array<keyof typeof toolMap>).map(async key => {
      if (allowedTools && !allowedTools.includes(key)) {
        return;
      }
      try {
        const toolDef = await toolMap[key](signal, transport, config, planFilePath);
        if (toolDef) {
          // @ts-ignore
          loaded[key] = toolDef;
        } else {
          logger.log("verbose", `Tool "${key}" returned null and was not loaded`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("info", `Failed to load tool "${key}"`, { error: errorMessage });
        // Fail fast for critical tools
        if (["read", "edit"].includes(key)) {
          throw new Error(`Critical tool "${key}" failed to load: ${errorMessage}`);
        }
      }
    }),
  );

  return loaded as LoadedTools;
}

export const READONLY_TOOLS = ["read", "list", "fetch", "skill", "web-search"] as const;
export const PLAN_MODE_TOOLS = [...READONLY_TOOLS, "write-plan"] as const;
export const SKIP_CONFIRMATION = [...READONLY_TOOLS, "write-plan"] as const;

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
): Promise<null> {
  const toolDef = lookup(loaded, tool);
  return await toolDef.validate(abortSignal, transport, tool, config);
}

function lookup<T extends ToolCall>(loaded: Partial<LoadedTools>, t: T): ToolDef<T> {
  const def = loaded[t.name];
  if (def == null) throw new ToolError(`No tool named ${t.name}`);
  return def as ToolDef<T>;
}
