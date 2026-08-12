import type { OctoIR } from "./octo-ir.ts";
import type { HistoryItem } from "../session-history/index.ts";

export function toLlmIR(history: HistoryItem[]): OctoIR[] {
  const irs: OctoIR[] = [];
  for (const item of history) {
    if (item.type === "llm-ir") irs.push(item.ir);
  }
  return irs;
}
