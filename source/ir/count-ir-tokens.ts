import { LlmIR } from "./llm-ir.ts";

export function countIRTokens(ir: LlmIR[]) {
  let totalTokens = 0;
  for(const item of ir) {
    if(item.role === "assistant") totalTokens += item.tokenUsage;
  }
  return totalTokens;
}
