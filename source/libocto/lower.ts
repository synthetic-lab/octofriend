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
  return messages.flatMap(ir => {
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

    if (ir.role === "subagent-trajectory") {
      return loweredTrajectory(ir);
    }
    return [ir];
  });
}

function loweredTrajectory<A extends Agent<any, any, any>>(
  trajectory: PreLoweredTrajectories<A["agents"], A["tools"]>,
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
  return lower(trajectory.ir as Array<PreLoweredIR<A>>);
}

// A trajectory finishes either with a plain response (an assistant message carrying no tool
// calls) or with a terminal error. Tool errors that the arc retries are not terminal: the arc
// appends its retry work after them, so they never stay at the end of a finished trajectory.
// Auth errors don't finish a subagent either: the supervisor surfaces them to the client, which
// can control the stalled subagent directly.
type TerminalError = Extract<
  PreLoweredIR<any>,
  {
    role: "tool-validation-error" | "tool-parse-error" | "tool-skip-output";
  }
>;

function isTerminalError(ir: PreLoweredIR<any>): ir is TerminalError {
  return (
    ir.role === "tool-validation-error" ||
    ir.role === "tool-parse-error" ||
    ir.role === "tool-skip-output"
  );
}

function errorMessage(ir: TerminalError): string {
  switch (ir.role) {
    case "tool-validation-error":
      return ir.error;
    case "tool-parse-error":
      return ir.malformedRequest.error;
    case "tool-skip-output":
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
