import toolMap from "./tool-defs/index.ts";
import { Config } from "../config.ts";
import { AbortError, Transport } from "../transports/transport-common.ts";
import { err, ok, errorToString, type Result } from "../libocto/result.ts";
import type { TrajectoryToolLoadError } from "../libocto/trajectory.ts";
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
): Promise<Result<Partial<LoadedTools>, TrajectoryToolLoadError>> {
  if (signal.aborted) return err({ type: "quit" });
  // TODO: Make tool factories return Results so loading can propagate failures without allSettled.
  const results = await Promise.allSettled(
    (Object.keys(toolMap) as Array<keyof typeof toolMap>).map(async key => ({
      key,
      toolDef: await toolMap[key]({ signal, transport, data: config }),
    })),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      if (signal.aborted && result.reason instanceof AbortError) continue;
      return err({ type: "fatal", error: errorToString(result.reason) });
    }
  }
  if (signal.aborted) return err({ type: "quit" });

  const loaded: Partial<LoadedTools> = {};
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { key, toolDef } = result.value;
    if (toolDef) {
      toolDef.name = key;
      // @ts-ignore
      loaded[key] = toolDef;
    }
  }
  return ok(loaded);
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
