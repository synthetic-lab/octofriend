import type { ExecutionArgs } from "../execution.ts";
import type { Agent, AllToolsAcrossTree, TreeToolMap } from "../llm-ir.ts";
import { err, ok, errorToString, type Result } from "../result.ts";
import { AbortError } from "../transport.ts";
import type { ToolDef } from "./tool-def.ts";

export type TrajectoryToolLoadError = { type: "quit" } | { type: "fatal"; error: string };

type UnionToIntersection<Union> = (Union extends Union ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;
type ToolDataFor<Def> =
  Def extends ToolDef<infer Data, infer _N, infer _A, infer _P, infer _S, infer _E> ? Data : never;
export type TreeToolData<A extends Agent<any, any, any, any>> = UnionToIntersection<
  ToolDataFor<AllToolsAcrossTree<A>[keyof AllToolsAcrossTree<A>]>
>;

type AnyAgent = Agent<any, any, any, any>;

function allTools<A extends AnyAgent>(agent: A): TreeToolMap<A> {
  const tools = { ...agent.tools };
  for (const name in agent.agents) {
    Object.assign(tools, allTools(agent.agents[name]));
  }
  return tools as TreeToolMap<A>;
}

export async function loadAgentTools<A extends AnyAgent>(
  agent: A,
  args: ExecutionArgs<TreeToolData<A>>,
): Promise<Result<Partial<AllToolsAcrossTree<A>>, TrajectoryToolLoadError>> {
  if (args.signal.aborted) return err({ type: "quit" });
  const toolMap = allTools(agent);

  // TODO: Make tool factories return Results so loading can propagate failures without allSettled.
  const results = await Promise.allSettled(
    (Object.keys(toolMap) as Array<keyof TreeToolMap<A>>).map(async key => ({
      key,
      toolDef: await toolMap[key](args),
    })),
  );
  for (const result of results) {
    if (result.status === "rejected") {
      if (args.signal.aborted && result.reason instanceof AbortError) continue;
      return err({ type: "fatal", error: errorToString(result.reason) });
    }
  }
  if (args.signal.aborted) return err({ type: "quit" });

  const loaded: Partial<AllToolsAcrossTree<A>> = {};
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { key, toolDef } = result.value;
    if (toolDef) {
      toolDef.name = key;
      loaded[key] = toolDef;
    }
  }
  return ok(loaded);
}
