import { t } from "structural";
import toolMap from "./tool-defs/index.ts";
import { ToolDef, ToolResult, ToolError } from "./common.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
export { ToolError } from "./common.ts";

export type LoadedTools = {
  [K in keyof typeof toolMap]: Exclude<Awaited<ReturnType<(typeof toolMap)[K]>>, null>;
};
export type ToolCall = {
  [K in keyof LoadedTools]: {
    parsed: {
      name: t.GetType<LoadedTools[K]["Schema"]>["name"];
      arguments: t.GetType<LoadedTools[K]["ParsedSchema"]>;
    };
    original: t.GetType<LoadedTools[K]["Schema"]>;
  };
}[keyof LoadedTools];

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

export const SKIP_CONFIRMATION_TOOLS: Array<keyof LoadedTools> = [
  "read",
  "list",
  "skill",
  "web-search",
  "glob",
  "grep",
  "lsp-definition",
  "lsp-references",
  "lsp-hover",
  "lsp-diagnostics",
  "lsp-document-symbol",
  "lsp-implementation",
  "lsp-incoming-calls",
  "lsp-outgoing-calls",
];

export const ALWAYS_REQUEST_PERMISSION_TOOLS: Array<keyof LoadedTools> = ["shell"];

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
  return await toolDef.validate(abortSignal, transport, tool.original, config);
}

function lookup<T extends ToolCall>(
  loaded: Partial<LoadedTools>,
  t: T,
): ToolDef<any, T["original"]["arguments"], any> {
  const def = loaded[t.original.name];
  if (def == null) throw new ToolError(`No tool named ${t.original.name}`);
  return def as ToolDef<any, T["original"]["arguments"], any>;
}
