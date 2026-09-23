import type { Agent, LoweredIR, PreLoweredIR } from "./llm-ir.ts";

export function lower<A extends Agent<any, any, any>>(
  messages: Array<PreLoweredIR<A>>,
): Array<LoweredIR<A["tools"]>> {
  const output: Array<LoweredIR<A["tools"]>> = [];

  for (const ir of sliceFromMostRecentCheckpoint(messages)) {
    if (ir.role === "checkpoint") {
      output.push({
        role: "lowered-checkpoint",
        content: ir.content,
      });
      continue;
    }

    if (ir.role === "tool-reject") {
      output.push({
        role: "tool-skip-output",
        toolCall: ir.toolCall,
        reason: "Tool call rejected by user.",
      });
      continue;
    }

    if (ir.role === "trajectory") {
      throw new Error("Subagent trajectory lowering is not implemented yet");
    }
    output.push(ir);
  }

  return output;
}

function sliceFromMostRecentCheckpoint<T extends { role: string }>(messages: T[]): T[] {
  return messages.slice(findMostRecentCheckpointIndex(messages));
}

function findMostRecentCheckpointIndex(messages: Array<{ role: string }>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "checkpoint") return i;
  }
  return 0;
}
