import toolMap from "./tool-defs/index.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import { Result, result } from "../result.ts";
import {
  LoadedTools as GenericLoadedTools,
  ToolCall as GenericToolCall,
  ToolFactoryRequirements,
  ToolReturn,
} from "../libocto/tool-def.ts";

export type LoadedTools = GenericLoadedTools<typeof toolMap>;
export type ToolCall = GenericToolCall<typeof toolMap>;
type ToolExtra<T> = T extends ToolFactoryRequirements<any, infer Extra> ? Extra : never;
export type ToolRunResult = ToolReturn<never, ToolExtra<(typeof toolMap)[keyof typeof toolMap]>>;

export async function loadTools(
  transport: Transport,
  signal: AbortSignal,
  config: Config,
): Promise<Partial<LoadedTools>> {
  const loaded: Partial<LoadedTools> = {};

  await Promise.all(
    (Object.keys(toolMap) as Array<keyof typeof toolMap>).map(async key => {
      const toolDef = await toolMap[key]({ signal, transport, data: config });
      if (toolDef) {
        (toolDef as any).name = key;
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
): Promise<Result<ToolRunResult, string>> {
  const def = lookup(loaded, call);
  if (!def.success) return def;
  const output = await (def.data as any).run({
    signal: abortSignal,
    transport,
    toolCall: {
      toolCallId: call.toolCallId,
      original: { name: call.name, arguments: call.original },
      parsed: { name: call.name, arguments: call.parsed },
    },
    data: config,
  });
  return output;
}

export async function validateTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  tool: ToolCall,
  config: Config,
): Promise<Result<null, string>> {
  const toolDef = lookup(loaded, tool);
  if (!toolDef.success) return toolDef;
  return await (toolDef.data as any).validate(
    abortSignal,
    transport,
    {
      original: { name: tool.name, arguments: tool.original },
      parsed: { name: tool.name, arguments: tool.parsed },
    },
    config,
  );
}

function lookup<T extends ToolCall>(loaded: Partial<LoadedTools>, t: T): Result<any, string> {
  const def = (loaded as any)[(t as any).name];
  if (def == null) return result.err(`No tool named ${t.name}`);
  return result.ok(def);
}
