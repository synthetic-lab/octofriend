import type { HistoryItem } from "../session-history/index.ts";
import type { OctoIR } from "./octo-ir.ts";
import type { TrajectoryOutputIR } from "../agent/trajectory-arc.ts";

export function outputToHistory(output: TrajectoryOutputIR[]): HistoryItem[] {
  return output.map(ir => ({
    type: "llm-ir",
    ir,
  }));
}

export function toLlmIR(history: HistoryItem[]): OctoIR[] {
  const irs: OctoIR[] = [];
  for (const item of history) {
    if (item.type === "llm-ir") irs.push(item.ir);
  }
  return irs;
}
