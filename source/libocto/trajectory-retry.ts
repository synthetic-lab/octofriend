import type { Agent, RecursiveLowered, RetryBudget } from "./llm-ir.ts";

// Snapshots are non-nested, atomic attempt groups. A legacy error or an incomplete
// group is not evidence that an automatic retry remains to be performed.
function snapshotStart<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
  end: number,
): number {
  if (history[end]?.converted.role !== "request-snapshot-end") return -1;
  for (let index = end - 1; index >= 0; index--) {
    const role = history[index].converted.role;
    if (role === "request-snapshot-begin") return index;
    if (role === "request-snapshot-end") return -1;
  }
  return -1;
}

export function latestRequestSnapshot<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): { retryBudget: RetryBudget; irs: readonly RecursiveLowered<A>[] } | null {
  const end = history.length - 1;
  const start = snapshotStart(history, end);
  if (start < 0 || start + 1 === end) return null;
  const begin = history[start].converted;
  if (begin.role !== "request-snapshot-begin") return null;
  return { retryBudget: begin.retryBudget, irs: history.slice(start + 1, end) };
}

export function retryable<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): boolean {
  const snapshot = latestRequestSnapshot(history);
  if (snapshot == null) return false;
  const { irs, retryBudget } = snapshot;
  const tip = irs.at(-1);
  if (tip == null || tip.converted.role === "interrupted-by-user") return false;
  if (validationFailure(irs)) {
    return (
      retryBudget.validation === null || countValidationErrors(history) <= retryBudget.validation
    );
  }
  return (
    transientError(tip) &&
    (retryBudget.requestError === null || countTransientErrors(history) <= retryBudget.requestError)
  );
}

export function transientError<A extends Agent<any, any, any>>({
  converted: ir,
}: RecursiveLowered<A>): boolean {
  switch (ir.role) {
    case "request-error":
    case "compaction-error":
    case "rate-limit-error":
      return true;
    case "assistant":
    case "user":
    case "checkpoint":
    case "request-snapshot-begin":
    case "request-snapshot-end":
    case "tool-output":
    case "tool-runtime-error":
    case "tool-validation-error":
    case "tool-parse-error":
    case "tool-skip-output":
    case "tool-reject":
    case "tool-invoke-subagent":
    case "subagent-trajectory":
    case "validation-retry-budget-exceeded":
    case "interrupted-by-user":
    case "auth-error":
    case "payment-error":
    case "error-dismissed":
    case "error-retry":
      return false;
    default: {
      const _exhaustive: never = ir;
      return _exhaustive;
    }
  }
}

export function validationFailure<A extends Agent<any, any, any>>(
  snapshot: readonly RecursiveLowered<A>[],
): boolean {
  return snapshot.some(({ converted: ir }) => {
    return ir.role === "tool-parse-error" || (ir.role === "tool-validation-error" && !ir.aborted);
  });
}

function failedSnapshot<A extends Agent<any, any, any>>(
  snapshot: readonly RecursiveLowered<A>[],
): boolean {
  return snapshot.some(({ converted: ir }) => {
    switch (ir.role) {
      case "request-error":
      case "compaction-error":
      case "rate-limit-error":
      case "auth-error":
      case "payment-error":
      case "tool-parse-error":
      case "tool-validation-error":
      case "tool-runtime-error":
      case "tool-reject":
      case "tool-skip-output":
      case "validation-retry-budget-exceeded":
      case "interrupted-by-user":
        return true;
      case "assistant":
      case "user":
      case "checkpoint":
      case "tool-output":
      case "tool-invoke-subagent":
      case "subagent-trajectory":
      case "request-snapshot-begin":
      case "request-snapshot-end":
      case "error-dismissed":
      case "error-retry":
        return false;
      default: {
        const _exhaustive: never = ir;
        return _exhaustive;
      }
    }
  });
}

// Iterate completed failed attempts in this branch, stopping at a successful snapshot
// or explicit reset. Do not include legacy errors or descend into children.
function* failedSnapshots<A extends Agent<any, any, any>>(history: readonly RecursiveLowered<A>[]) {
  for (let index = history.length - 1; index >= 0; index--) {
    const ir = history[index].converted;
    switch (ir.role) {
      case "request-snapshot-end": {
        const start = snapshotStart(history, index);
        if (start < 0) return;
        const snapshot = history.slice(start + 1, index);
        if (snapshot.length === 0 || !failedSnapshot(snapshot)) return;
        if (snapshot.some(pair => pair.converted.role === "interrupted-by-user")) return;
        yield snapshot;
        index = start;
        break;
      }
      case "request-snapshot-begin":
      case "checkpoint":
      case "error-retry":
      case "error-dismissed":
      case "interrupted-by-user":
        return;
      case "assistant":
      case "user":
      case "request-error":
      case "compaction-error":
      case "rate-limit-error":
      case "auth-error":
      case "payment-error":
      case "tool-output":
      case "tool-runtime-error":
      case "tool-validation-error":
      case "tool-parse-error":
      case "tool-skip-output":
      case "tool-reject":
      case "tool-invoke-subagent":
      case "subagent-trajectory":
      case "validation-retry-budget-exceeded":
        break;
      default: {
        const _exhaustive: never = ir;
        return _exhaustive;
      }
    }
  }
}

export function countValidationErrors<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): number {
  let count = 0;
  for (const snapshot of failedSnapshots(history)) {
    if (validationFailure(snapshot)) count++;
  }
  return count;
}

export function countTransientErrors<A extends Agent<any, any, any>>(
  history: readonly RecursiveLowered<A>[],
): number {
  let count = 0;
  for (const snapshot of failedSnapshots(history)) {
    if (snapshot.some(pair => transientError(pair))) count++;
  }
  return count;
}

export const VALIDATION_RETRY_BUDGET_EXCEEDED_ERROR =
  "The model repeatedly produced invalid tool calls";
