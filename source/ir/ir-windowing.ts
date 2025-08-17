import { LlmIR } from "./llm-ir.ts";

export function countIRTokens(ir: LlmIR[]) {
  let totalTokens = 0;
  for(const item of ir) {
    if(item.role === "assistant") totalTokens += item.tokenUsage;
  }
  return totalTokens;
}

export type WindowedIR = {
  appliedWindow: boolean,
  ir: LlmIR[],
};

// Apply sliding window to keep context under token limit
export function applyContextWindow(ir: LlmIR[], context: number): WindowedIR {
  const MAX_CONTEXT_TOKENS = Math.floor(context * 0.8);

  let totalTokens = countIRTokens(ir);
  if(totalTokens <= MAX_CONTEXT_TOKENS) return { appliedWindow: false, ir };

  const windowedIR: LlmIR[] = [];
  let runningTokens = 0;

  // Work backwards from the end of history up to the budget
  for (let i = ir.length - 1; i >= 0; i--) {
    const item = ir[i];

    if (item.role === "assistant") {
      if (runningTokens + item.tokenUsage > MAX_CONTEXT_TOKENS) break;
      runningTokens += item.tokenUsage;
    }

    windowedIR.unshift(item);
  }

  // If we couldn't fit any messages, throw an error
  if (windowedIR.length === 0) {
    throw new Error("No IR slice was small enough to fit in the context window budget");
  }

  return {
    appliedWindow: true,
    ir: windowedIR,
  };
}
