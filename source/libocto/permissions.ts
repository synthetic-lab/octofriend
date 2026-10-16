import type { Agent, TreeToolCall, UserMessage } from "./llm-ir.ts";
import { err, ok, type Result } from "./result.ts";

export type PermissionDecision =
  | { decision: "allow" }
  | { decision: "reject"; steering: UserMessage["content"] };

// The gate handles calls from every agent, including descendant-only tools.
export type PermissionGate<A extends Agent<any, any, any>> = (
  toolCall: TreeToolCall<A>,
) => Promise<PermissionDecision>;

/*
 * Waits for a permission gate's decision, racing it against an abort signal. A gate may park
 * indefinitely (e.g. waiting on a user prompt), so loops must not await it bare: when the signal
 * aborts, this resolves "aborted" and the loop stops waiting on the gate, which is left to settle
 * (or not) on its own.
 */
export async function waitForPermissionDecision<Call>(
  gate: (toolCall: Call) => Promise<PermissionDecision>,
  toolCall: Call,
  signal: AbortSignal,
): Promise<Result<PermissionDecision, "aborted">> {
  if (signal.aborted) return err("aborted");
  let onAbort!: () => void;
  const aborted = new Promise<Result<PermissionDecision, "aborted">>(resolve => {
    onAbort = () => resolve(err("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const decision = await Promise.race([gate(toolCall).then(ok), aborted]);
  signal.removeEventListener("abort", onAbort);
  return decision;
}
