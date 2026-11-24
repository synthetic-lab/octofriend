import type { RequestSnapshotBeginIR, RequestSnapshotEndIR, RetryBudget } from "./llm-ir.ts";

// Called only after an operation has finalized its outcome. Persist the returned group
// atomically; neither boundary is an in-flight notification.
export function requestSnapshot<IR>(
  irs: IR[],
  retryBudget: RetryBudget,
): Array<IR | RequestSnapshotBeginIR | RequestSnapshotEndIR> {
  return [
    {
      role: "request-snapshot-begin",
      retryBudget: {
        validation: retryBudget.validation === Infinity ? null : retryBudget.validation,
        requestError: retryBudget.requestError === Infinity ? null : retryBudget.requestError,
      },
    },
    ...irs,
    { role: "request-snapshot-end" },
  ];
}
