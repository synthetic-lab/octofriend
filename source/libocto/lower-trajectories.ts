import type { Agent, LoweredIR, LoweredIRWithTrajectories } from "./llm-ir.ts";

export function lowerTrajectories<A extends Agent<any, any, any>>(
  messages: Array<LoweredIRWithTrajectories<A>>,
): Array<LoweredIR<A["tools"]>> {
  const output: Array<LoweredIR<A["tools"]>> = [];

  for (const ir of messages) {
    if (ir.role === "trajectory") {
      throw new Error("Subagent trajectory lowering is not implemented yet");
    }
    output.push(ir);
  }

  return output;
}
