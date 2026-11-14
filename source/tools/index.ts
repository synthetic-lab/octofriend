import toolMap from "./tool-defs/index.ts";
import type { ExecutionArgs, ExecutionModel } from "../libocto/execution.ts";
import { AbortError, Transport } from "../libocto/transport.ts";
import { err, ok, errorToString, type Result } from "../libocto/result.ts";
import type { TrajectoryToolLoadError } from "../libocto/trajectory.ts";
import {
  LoadedTools as GenericLoadedTools,
  ToolCall as GenericToolCall,
} from "../libocto/tool-def.ts";

export type LoadedTools = GenericLoadedTools<typeof toolMap>;
export type ToolCall = GenericToolCall<typeof toolMap>;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
type ToolFactoryData<Factory> = Factory extends (args: ExecutionArgs<infer Data>) => unknown
  ? Data
  : never;
export type ToolData = UnionToIntersection<ToolFactoryData<(typeof toolMap)[keyof typeof toolMap]>>;

export async function loadTools(
  transport: Transport,
  signal: AbortSignal,
  model: ExecutionModel,
  data: ToolData,
): Promise<Result<Partial<LoadedTools>, TrajectoryToolLoadError>> {
  if (signal.aborted) return err({ type: "quit" });
  // TODO: Make tool factories return Results so loading can propagate failures without allSettled.
  const results = await Promise.allSettled(
    (Object.keys(toolMap) as Array<keyof typeof toolMap>).map(async key => ({
      key,
      toolDef: await toolMap[key]({ signal, transport, model, data }),
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
  "web-research",
  "glob",
  "grep",
  "explore",
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
