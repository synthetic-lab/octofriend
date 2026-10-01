import toolMap from "./tool-defs/index.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";
import {
  LoadedTools as GenericLoadedTools,
  ToolCall as GenericToolCall,
} from "../libocto/tool-def.ts";

export type LoadedTools = GenericLoadedTools<typeof toolMap>;
export type ToolCall = GenericToolCall<typeof toolMap>;

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
        toolDef.name = key;
        // @ts-ignore
        loaded[key] = toolDef;
      }
    }),
  );

  return loaded as LoadedTools;
}

export const SKIP_CONFIRMATION_TOOLS: Array<keyof LoadedTools> = [
  "read",
  "partial-read",
  "list",
  "skill",
  "web-search",
  "fetch",
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
  "manage-background-process",
];

export const ALWAYS_REQUEST_PERMISSION_TOOLS: Array<keyof LoadedTools> = [
  "shell",
  "background-process",
];
