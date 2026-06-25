import { isDeepStrictEqual } from "node:util";
import { HistoryItem, SessionNode } from "./index.ts";

export function hasMessages(history: HistoryItem[]): boolean {
  return history.some(item => item.type === "llm-ir");
}

export function commonPathPrefixLength(nodePath: SessionNode[], history: HistoryItem[]): number {
  const length = Math.min(nodePath.length, history.length);
  let position = 0;
  while (position < length && sameHistoryItem(nodePath[position].historyItem, history[position])) {
    position++;
  }
  return position;
}

function sameHistoryItem(a: HistoryItem, b: HistoryItem): boolean {
  if (a.type !== b.type) return false;

  switch (a.type) {
    case "llm-ir":
      return b.type === "llm-ir" && isDeepStrictEqual(a.ir, b.ir);
    case "notification":
      return b.type === "notification" && a.content === b.content;
    case "request-failed":
    case "compaction-failed":
      return true;
  }
}
