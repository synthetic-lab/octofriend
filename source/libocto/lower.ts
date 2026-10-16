import type {
  Agent,
  AssistantMessage,
  LoweredIR,
  PreLoweredIR,
  PreLoweredTrajectories,
} from "./llm-ir.ts";

export function lower<A extends Agent<any, any, any>>(
  messages: Array<PreLoweredIR<A>>,
): Array<LoweredIR<A["tools"]>> {
  const sliced = sliceFromMostRecentCheckpoint(messages);
  const last = sliced[sliced.length - 1];
  if (last != null && last.role === "subagent-trajectory" && isTrajectoryRunning(last)) {
    // The most recent subagent invocation is a slice point: everything before it, including the
    // still-unanswered tool call that delegated, compresses away, and the trajectory presents its
    // own work by re-lowering.
    const invocation =
      sliced[sliced.length - 2]?.role === "tool-invoke-subagent"
        ? sliced.length - 2
        : sliced.length - 1;
    return lowered(sliced.slice(invocation));
  }
  return lowered(sliced);
}

function lowered<A extends Agent<any, any, any>>(
  messages: Array<PreLoweredIR<A>>,
): Array<LoweredIR<A["tools"]>> {
  return messages.flatMap((ir, index) => {
    if (ir.role === "checkpoint") {
      return [
        {
          role: "lowered-checkpoint",
          content: ir.content,
        },
      ];
    }

    if (ir.role === "tool-reject") {
      return [
        {
          role: "tool-skip-output",
          toolCall: ir.toolCall,
          reason: "Tool call rejected by user.",
        },
      ];
    }

    if (ir.role === "tool-invoke-subagent") {
      return [];
    }

    if (
      ir.role === "request-error" ||
      ir.role === "compaction-error" ||
      ir.role === "validation-retry-budget-exceeded" ||
      ir.role === "interrupted-by-user"
    ) {
      return [];
    }

    if (ir.role === "subagent-trajectory") {
      return loweredTrajectory(ir, index === messages.length - 1);
    }
    return [ir];
  });
}

function loweredTrajectory<A extends Agent<any, any, any>>(
  trajectory: PreLoweredTrajectories<A["agents"], A["tools"]>,
  isLast: boolean,
): Array<LoweredIR<A["tools"]>> {
  const last = trajectory.ir[trajectory.ir.length - 1];
  if (last != null && isAssistantMessage(last) && !last.toolCalls) {
    return [
      {
        role: "tool-output",
        toolCall: trajectory.toolCall,
        content: [{ type: "text", content: last.content }],
      },
    ];
  }
  if (last != null && isTerminalError(last)) {
    return [
      {
        role: "tool-runtime-error",
        toolCall: trajectory.toolCall,
        error: errorMessage(last),
      },
    ];
  }
  if (isLast) {
    return lower(trajectory.ir as Array<PreLoweredIR<A>>);
  }
  if (process.env["CANARY_OCTO"] === "1") {
    throw new Error(`Subagent ${trajectory.subagent} has IRs after it but no terminal state`);
  }
  return [
    {
      role: "tool-runtime-error",
      toolCall: trajectory.toolCall,
      error: "The subagent never completed.",
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

function isTerminalError(ir: PreLoweredIR<any>): ir is TerminalError {
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

function isTrajectoryRunning(trajectory: PreLoweredTrajectories<any, any>): boolean {
  const last = trajectory.ir[trajectory.ir.length - 1];
  if (last == null) return true;
  if (isAssistantMessage(last) && !last.toolCalls) return false;
  if (isTerminalError(last)) return false;
  return true;
}

// PreLoweredIR has no extension-IR leg, so role checks narrow it cleanly; this predicate exists
// because TypeScript cannot narrow the annotation's literal role out of generic unions the same
// way in every context.
function isAssistantMessage(ir: PreLoweredIR<any>): ir is AssistantMessage<any> {
  return ir.role === "assistant";
}

function sliceFromMostRecentCheckpoint<T extends { role: string }>(messages: T[]): T[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "checkpoint") return messages.slice(i);
  }
  return messages;
}
