import { answeredToolCallId } from "./llm-ir.ts";
import type {
  Agent,
  AgentDirectory,
  AgentIR,
  AgentTrajectory,
  AllTrajectories,
  TreeIR,
  LowerInputIR,
  LowerOutputIR,
  CompilerReadyIR,
  RecursiveLowered,
  PreLoweredIR,
} from "./llm-ir.ts";
import type { ToolCall } from "./tool-def.ts";
import type { ScopeHop, ScopeRoot, ScopeSubagent } from "./trajectory.ts";

// Temporary references derived from the IR, never a saved execution frame. Each named child
// retains its own agent/history types and the raw objects needed by scoped append events.
type ChildHistory<
  Root extends Agent<any, any, any>,
  Parent extends Agent<any, any, any>,
  Name extends keyof Parent["agents"] & string,
> = ScopeSubagent<Name> & {
  agent: Parent["agents"][Name];
  history: Array<AgentIR<Parent["agents"][Name]>>;
  scope: {
    path: readonly ScopeHop[];
    parentSubagentIR: AgentTrajectory<Parent["agents"], Name, Parent["tools"]>;
    toplevelSubagentIR: AllTrajectories<Root["agents"], Root["tools"]>;
  };
};

type DescendantHistories<
  Root extends Agent<any, any, any>,
  Parent extends Agent<any, any, any>,
> = string extends keyof Parent["agents"]
  ? ChildHistory<Root, Parent, keyof Parent["agents"] & string>
  : {
      [K in keyof Parent["agents"] & string]:
        | ChildHistory<Root, Parent, K>
        | DescendantHistories<Root, Parent["agents"][K]>;
    }[keyof Parent["agents"] & string];

export type ActiveHistory<A extends Agent<any, any, any>> =
  | (ScopeRoot & { agent: A; history: Array<AgentIR<A>> })
  | DescendantHistories<A, A>;

// Inspect a recursively downconverted view, but return only references into the live raw tree.
// The result is temporary: call again after appending rather than saving execution frames.
export function activeHistory<A extends Agent<any, any, any>>(
  agent: A,
  history: Array<AgentIR<A>>,
  converted: readonly RecursiveLowered<A>[],
): ActiveHistory<A> {
  let currentAgent: { agents: AgentDirectory } = agent;
  let currentHistory: Array<TreeIR<A>> = history;
  let inspected = converted;
  let scope:
    | {
        path: ScopeHop[];
        parentSubagentIR: TreeIR<A>;
        toplevelSubagentIR: TreeIR<A>;
      }
    | undefined;

  while (true) {
    const tail = inspected.at(-1);
    if (tail?.converted.role !== "subagent-trajectory" || !isTrajectoryRunning(tail.converted)) {
      break;
    }

    const original = tail.original;
    // downconvert alone creates trajectory pairs, so this is a raw trajectory by construction.
    if (!isRawTrajectory(original))
      throw new Error("A converted trajectory must retain its raw original");
    const child = currentAgent.agents[original.subagent];
    if (child == null) throw new Error(`Unknown subagent: ${original.subagent}`);
    scope = {
      path: [
        ...(scope?.path ?? []),
        { subagent: original.subagent, toolCallId: original.toolCall.toolCallId },
      ],
      parentSubagentIR: original,
      toplevelSubagentIR: scope?.toplevelSubagentIR ?? original,
    };
    currentAgent = child;
    currentHistory = original.ir;
    inspected = tail.converted.ir;
  }

  if (scope == null) return { root: true, agent, history };

  // Each descent selects the agent and raw history from the same named trajectory. TS cannot
  // retain that correlation through a dynamic directory lookup, but no child is retyped as root.
  return {
    root: false,
    subagent: scope.path[scope.path.length - 1].subagent,
    scope,
    agent: currentAgent,
    history: currentHistory,
  } as ActiveHistory<A>;
}

// Clients receive only contiguous non-trajectory runs. Libocto alone constructs trajectory
// pairs, retaining the live original while recursively converting a separate inspection view.
export function downconvert<A extends Agent<any, any, any>>(
  lowerExtras: (messages: Array<LowerInputIR<A>>) => Array<LowerOutputIR<A>>,
): (messages: Array<TreeIR<A>>) => Array<RecursiveLowered<A>> {
  const convert = (messages: Array<TreeIR<A>>): Array<RecursiveLowered<A>> => {
    const output: Array<RecursiveLowered<A>> = [];
    let pending: Array<LowerInputIR<A>> = [];
    const flush = () => {
      if (pending.length === 0) return;
      output.push(...lowerExtras(pending));
      pending = [];
    };

    for (const original of messages) {
      if (isRawTrajectory(original)) {
        flush();
        output.push({
          original,
          converted: {
            ...original,
            ir: convert(original.ir),
          } as PreLoweredIR<A>,
        });
      } else {
        // The role check excludes trajectories; TS cannot reduce Exclude over a generic tree.
        pending.push(original as LowerInputIR<A>);
      }
    }
    flush();
    return output;
  };
  return convert;
}

// Only used on a raw TreeIR union, whose trajectory children belong to that same tree.
function isRawTrajectory<IR>(ir: IR): ir is IR & {
  role: "subagent-trajectory";
  subagent: string;
  toolCall: { toolCallId: string };
  ir: IR[];
} {
  return typeof ir === "object" && ir !== null && "role" in ir && ir.role === "subagent-trajectory";
}

// Inspect one history, not its descendants. Only answers after the latest assistant batch
// count, since providers may reuse call IDs in later turns.
export function pendingToolCalls<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): Array<ToolCall<A["tools"]>> {
  const answered = new Set<string>();
  for (let index = history.length - 1; index >= 0; index--) {
    const ir = history[index].converted;
    if (ir.role === "assistant") {
      return (ir.toolCalls ?? []).filter(
        (call): call is ToolCall<A["tools"]> =>
          call.type === "tool-call" && !answered.has(call.toolCallId),
      );
    }
    if (ir.role === "user" || ir.role === "checkpoint") return [];
    if (ir.role === "subagent-trajectory") {
      if (!isTrajectoryRunning(ir)) answered.add(ir.toolCall.toolCallId);
      continue;
    }
    const toolCallId = answeredToolCallId(ir);
    if (toolCallId != null) answered.add(toolCallId);
  }
  return [];
}

export function lower<A extends Agent<any, any, any>>(
  messages: Array<RecursiveLowered<A>>,
): Array<CompilerReadyIR<A>> {
  const sliced = sliceFromMostRecentCheckpoint(messages);
  const last = sliced[sliced.length - 1]?.converted;
  if (last != null && last.role === "subagent-trajectory" && isTrajectoryRunning(last)) {
    // The most recent subagent invocation is a slice point: everything before it, including the
    // still-unanswered tool call that delegated, compresses away, and the trajectory presents its
    // own work by re-lowering.
    const invocation =
      sliced[sliced.length - 2]?.converted.role === "tool-invoke-subagent"
        ? sliced.length - 2
        : sliced.length - 1;
    return lowered<A>(sliced.slice(invocation));
  }
  return lowered<A>(sliced);
}

function lowered<A extends Agent<any, any, any>>(
  messages: Array<RecursiveLowered<A>>,
): Array<CompilerReadyIR<A>> {
  return messages.flatMap<CompilerReadyIR<A>>(({ original, converted }, index) => {
    if (converted.role === "checkpoint") {
      return [
        {
          original,
          converted: { role: "lowered-checkpoint", content: converted.content },
        },
      ];
    }

    if (converted.role === "tool-reject") {
      return [
        {
          original,
          converted: {
            role: "tool-skip-output",
            toolCall: converted.toolCall,
            reason: "Tool call rejected by user.",
          },
        },
      ];
    }

    if (converted.role === "tool-invoke-subagent") {
      return [];
    }

    if (
      converted.role === "request-error" ||
      converted.role === "compaction-error" ||
      converted.role === "validation-retry-budget-exceeded" ||
      converted.role === "interrupted-by-user"
    ) {
      return [];
    }

    if (converted.role === "subagent-trajectory") {
      return loweredTrajectory<A>(original, converted, index === messages.length - 1);
    }
    return [{ original, converted }];
  });
}

function loweredTrajectory<A extends Agent<any, any, any>>(
  original: TreeIR<A>,
  trajectory: RecursiveLowered<A>["converted"] & { role: "subagent-trajectory" },
  isLast: boolean,
): Array<CompilerReadyIR<A>> {
  const last = trajectory.ir[trajectory.ir.length - 1]?.converted;
  if (last != null && last.role === "assistant" && !last.toolCalls?.length) {
    return [
      {
        original,
        converted: {
          role: "tool-output",
          toolCall: trajectory.toolCall,
          content: [{ type: "text", content: last.content }],
        },
      },
    ];
  }
  if (last != null && isTerminalError(last)) {
    return [
      {
        original,
        converted: {
          role: "tool-runtime-error",
          toolCall: trajectory.toolCall,
          error: errorMessage(last),
        },
      },
    ];
  }
  if (isLast) {
    return lower(trajectory.ir);
  }
  if (process.env["CANARY_OCTO"] === "1") {
    throw new Error(`Subagent ${trajectory.subagent} has IRs after it but no terminal state`);
  }
  return [
    {
      original,
      converted: {
        role: "tool-runtime-error",
        toolCall: trajectory.toolCall,
        error: "The subagent never completed.",
      },
    },
  ];
}

// A trajectory finishes either with a plain response (an assistant message carrying no tool
// calls) or with a terminal error. Tool errors that the arc retries are not terminal: the arc
// appends its retry work after them, so they never stay at the end of a finished trajectory.
// Auth errors don't finish a subagent either: the supervisor surfaces them to the client, which
// can control the stalled subagent directly.
const TERMINAL_ERROR_ROLES = [
  "tool-validation-error",
  "tool-parse-error",
  "tool-skip-output",
  "request-error",
  "compaction-error",
  "validation-retry-budget-exceeded",
  "interrupted-by-user",
] as const;

type TerminalError = Extract<PreLoweredIR<any>, { role: (typeof TERMINAL_ERROR_ROLES)[number] }>;

function isTerminalError(ir: { role: string }): ir is TerminalError {
  return (TERMINAL_ERROR_ROLES as readonly string[]).includes(ir.role);
}

function errorMessage(ir: TerminalError): string {
  switch (ir.role) {
    case "tool-validation-error":
      return ir.error;
    case "tool-parse-error":
      return ir.malformedRequest.error;
    case "tool-skip-output":
      return ir.reason;
    case "request-error":
    case "compaction-error":
      return ir.requestError;
    case "validation-retry-budget-exceeded":
      return ir.error;
    case "interrupted-by-user":
      return ir.reason;
  }
}

// Callers must recursively convert extension IRs before testing the tail.
export function isTrajectoryRunning(trajectory: {
  ir: readonly { converted: { role: string; toolCalls?: readonly unknown[] } }[];
}): boolean {
  const last = trajectory.ir[trajectory.ir.length - 1]?.converted;
  if (last == null) return true;
  if (last.role === "assistant" && !last.toolCalls?.length) return false;
  if (isTerminalError(last)) return false;
  return true;
}

function sliceFromMostRecentCheckpoint<T extends { converted: { role: string } }>(
  messages: T[],
): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].converted.role === "checkpoint") return messages.slice(i);
  }
  return messages;
}
