import { answeredToolCallId } from "./llm-ir.ts";
import type {
  Agent,
  AgentIR,
  Lower,
  CompilerReadyIR,
  RecursiveLowered,
  PreLoweredIR,
  PreLoweredTrajectories,
} from "./llm-ir.ts";
import type { ToolCall } from "./tool-def.ts";

// Every converted item retains its original, including recursively converted child histories.
export function downconvert<A extends Agent<any, any, any>>(
  lowerExtras: (messages: Array<AgentIR<A>>) => Array<Lower<A>>,
): (messages: Array<AgentIR<A>>) => Array<RecursiveLowered<A>> {
  const convert = (messages: Array<AgentIR<A>>): Array<RecursiveLowered<A>> =>
    lowerExtras(messages).map(({ original, converted }) => {
      if (converted.role !== "subagent-trajectory") return { original, converted };
      return {
        original,
        converted: {
          ...converted,
          ir: convert(converted.ir as Array<AgentIR<A>>),
        } as PreLoweredIR<A>,
      };
    });
  return convert;
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
  original: AgentIR<A>,
  trajectory: PreLoweredTrajectories<A["agents"], A["tools"]>,
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
export function isTrajectoryRunning(trajectory: PreLoweredTrajectories<any, any>): boolean {
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
