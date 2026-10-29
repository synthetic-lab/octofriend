import type { RequestSnapshotBeginIR, RequestSnapshotEndIR } from "./llm-ir.ts";

// Called only after an operation has finalized its outcome. Persist the returned group
// atomically; neither boundary is an in-flight notification.
export function requestSnapshot<IR>(
  irs: IR[],
): Array<IR | RequestSnapshotBeginIR | RequestSnapshotEndIR> {
  return [{ role: "request-snapshot-begin" }, ...irs, { role: "request-snapshot-end" }];
}
