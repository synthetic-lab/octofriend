import { answeredToolCallId } from "./llm-ir.ts";
import type {
  Agent,
  AgentDirectory,
  AgentIR,
  AgentTrajectory,
  AllTrajectories,
  TreeIR,
  TreeToolCall,
  LowerInputIR,
  LowerOutputIR,
  CompilerReadyIR,
  RecursiveLowered,
  PreLoweredIR,
  ModelErrorIR,
  RequestErrorIR,
  CompactionErrorIR,
  ValidationRetryBudgetExceededIR,
  UserMessage,
} from "./llm-ir.ts";
import type { ScopeHop, ScopeRoot, ScopeSubagent } from "./trajectory.ts";
import { err, ok, type Result } from "./result.ts";

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
> = (string extends keyof Parent["agents"]
  ? ChildHistory<Root, Parent, keyof Parent["agents"] & string>
  : {
      [K in keyof Parent["agents"] & string]:
        | ChildHistory<Root, Parent, K>
        | DescendantHistories<Root, Parent["agents"][K]>;
    }[keyof Parent["agents"] & string]) &
  ScopeSubagent<string> & {
    agent: { tools: object; agents: AgentDirectory };
    history: Array<TreeIR<Root>>;
    scope: {
      parentSubagentIR: TreeIR<Root> & {
        role: "subagent-trajectory";
        task: UserMessage["content"];
      };
      toplevelSubagentIR: AllTrajectories<Root["agents"], Root["tools"]>;
    };
  };

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
  return walkHistory(agent, history, converted).location;
}

function walkHistory<A extends Agent<any, any, any>>(
  agent: A,
  history: Array<AgentIR<A>>,
  converted: readonly RecursiveLowered<A>[],
): { location: ActiveHistory<A>; converted: readonly RecursiveLowered<A>[] } {
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

  if (scope == null) return { location: { root: true, agent, history }, converted: inspected };

  // Each descent selects the agent and raw history from the same named trajectory. TS cannot
  // retain that correlation through a dynamic directory lookup, but no child is retyped as root.
  const location = {
    root: false,
    subagent: scope.path[scope.path.length - 1].subagent,
    scope,
    agent: currentAgent,
    history: currentHistory,
  } as ActiveHistory<A>;
  return { location, converted: inspected };
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

// Select the active branch from the whole converted tree before scanning its latest batch.
// Answers stay local to that history; descendants' IDs never answer their parent's calls.
export function pendingToolCalls<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): Array<TreeToolCall<A>> {
  while (true) {
    const tail = history.at(-1)?.converted;
    if (tail?.role !== "subagent-trajectory" || !isTrajectoryRunning(tail)) break;
    history = tail.ir;
  }
  return scanPendingCalls(history);
}

function scanPendingCalls<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): Array<TreeToolCall<A>> {
  const answered = new Set<string>();
  for (let index = history.length - 1; index >= 0; index--) {
    const ir = history[index].converted;
    if (ir.role === "assistant") {
      // The recursive inspection view bounds descendant schemas structurally; these are
      // still the concrete calls from an agent in A's tree, filtered without copying them.
      const calls = (ir.toolCalls ?? []).filter(
        call => call.type === "tool-call" && !answered.has(call.toolCallId),
      );
      return calls as Array<TreeToolCall<A>>;
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
      converted.role === "interrupted-by-user" ||
      converted.role === "auth-error" ||
      converted.role === "payment-error" ||
      converted.role === "rate-limit-error" ||
      converted.role === "error-dismissed" ||
      converted.role === "error-retry"
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

export type HistoryInspection<A extends Agent<any, any, any>> = {
  pendingCalls: Array<TreeToolCall<A>>;
} & (
  | {
      action: "rectify";
      location: ActiveHistory<A>;
      tail: ModelErrorIR;
    }
  | {
      action: "rectify";
      location: ScopeRoot & { agent: A; history: Array<AgentIR<A>> };
      tail: RequestErrorIR | CompactionErrorIR | ValidationRetryBudgetExceededIR;
    }
  | {
      action: "wait-for-input";
      location: ScopeRoot & { agent: A; history: Array<AgentIR<A>> };
      tail: RecursiveLowered<A>["converted"] | undefined;
    }
  | {
      action: "respond";
      location: ActiveHistory<A>;
      tail: RecursiveLowered<A>["converted"];
    }
  | {
      action: "invoke-subagent";
      location: ActiveHistory<A>;
      tail: RecursiveLowered<A>["converted"] & { role: "tool-invoke-subagent" };
    }
  | {
      action: "run-tools";
      location: ActiveHistory<A>;
      tail: RecursiveLowered<A>["converted"];
      pendingCalls: [TreeToolCall<A>, ...Array<TreeToolCall<A>>];
    }
);

export function inspectHistory<A extends Agent<any, any, any>>(
  agent: A,
  history: Array<AgentIR<A>>,
  converted: readonly RecursiveLowered<A>[],
): Result<HistoryInspection<A>, string> {
  const { location, converted: selected } = walkHistory(agent, history, converted);
  const tail = selected.at(-1)?.converted;
  const pendingCalls = scanPendingCalls<A>(selected);
  if (tail == null) {
    if (!location.root) return err("Cannot execute a subagent with an empty history");
    return ok({ location, pendingCalls, action: "wait-for-input", tail });
  }
  const common = { location, pendingCalls };

  if (tail.role === "tool-invoke-subagent") {
    return ok({ ...common, action: "invoke-subagent", tail });
  }
  if (
    tail.role === "auth-error" ||
    tail.role === "payment-error" ||
    tail.role === "rate-limit-error"
  ) {
    return ok({ ...common, action: "rectify", tail });
  }
  if (location.root) {
    if (
      tail.role === "request-error" ||
      tail.role === "compaction-error" ||
      tail.role === "validation-retry-budget-exceeded"
    ) {
      return ok({ location, pendingCalls, action: "rectify", tail });
    }
    if (
      tail.role === "error-dismissed" ||
      (pendingCalls.length === 0 && !isTrajectoryRunning({ ir: selected }))
    ) {
      return ok({ location, pendingCalls, action: "wait-for-input", tail });
    }
  }
  const [first, ...remaining] = pendingCalls;
  if (first != null) {
    return ok({ ...common, tail, action: "run-tools", pendingCalls: [first, ...remaining] });
  }
  return ok({ ...common, tail, action: "respond" });
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
