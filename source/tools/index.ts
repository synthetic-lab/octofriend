import toolMap from "./tool-defs/index.ts";
import { ToolError } from "./common.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import {
  LoadedTools as GenericLoadedTools,
  ToolCall as GenericToolCall,
  ToolFactoryRequirements,
  ToolReturn,
} from "../libocto/tool-def.ts";
export { ToolError } from "./common.ts";

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
): Promise<ToolRunResult> {
  const def = lookup(loaded, call);
  const output = await (def as any).run({
    signal: abortSignal,
    transport,
    toolCall: {
      toolCallId: call.toolCallId,
      original: { name: call.name, arguments: call.original },
      parsed: { name: call.name, arguments: call.parsed },
    },
    data: config,
  });
  if (!output.success) throw new ToolError(output.error);
  return output.data;
}

export async function validateTool(
  abortSignal: AbortSignal,
  transport: Transport,
  loaded: Partial<LoadedTools>,
  tool: ToolCall,
  config: Config,
): Promise<null> {
  const toolDef = lookup(loaded, tool);
  const validation = await (toolDef as any).validate(
    abortSignal,
    transport,
    {
      original: { name: tool.name, arguments: tool.original },
      parsed: { name: tool.name, arguments: tool.parsed },
    },
    config,
  );
  if (!validation.success) throw new ToolError(validation.error);
  return null;
}

function lookup<T extends ToolCall>(loaded: Partial<LoadedTools>, t: T): any {
  const def = (loaded as any)[(t as any).name];
  if (def == null) throw new ToolError(`No tool named ${t.name}`);
  return def;
}
