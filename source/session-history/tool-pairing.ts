import { answeredToolCallId } from "../libocto/llm-ir.ts";
import type { OctoIR } from "../ir/octo-ir.ts";
import type { HistoryNode } from "./index.ts";

/*
 * Tool call/output pairing assertions for hydrated session histories.
 *
 * Strict backends (e.g. Kimi K3) reject any request where a tool message's tool_call_id doesn't
 * resolve to a preceding assistant tool_call. We already found one way Octo produced such
 * requests (malformed tool requests dropped from assistant tool_calls while their tool messages
 * were still emitted), but there may be others hiding in long-lived sessions. These checks run
 * on session hydration and throw with a detailed violation report, so broken histories are
 * caught at load time rather than surfacing as an opaque 400 deep into a resume.
 */

type AssistantCallEntry = {
  id: string;
  callType: "tool-call" | "malformed-tool-request";
  // Index into the hydrated history array of the assistant IR carrying this call.
  index: number;
};

export type PairingViolation = {
  // Index into the hydrated history array of the offending IR.
  index: number;
  role: string;
  callId: string;
  problem: string;
};

export function findToolPairingViolations(history: readonly HistoryNode[]): PairingViolation[] {
  const violations: PairingViolation[] = [];

  const allCalls: AssistantCallEntry[] = [];
  let lastCheckpointIndex = -1;
  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (item.type !== "llm-ir") continue;
    if (item.ir.role === "checkpoint") lastCheckpointIndex = i;
    if (item.ir.role === "assistant") {
      for (const call of item.ir.toolCalls ?? []) {
        allCalls.push({ id: call.toolCallId, callType: call.type, index: i });
      }
    }
  }

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (item.type !== "llm-ir") continue;
    const ir = item.ir;
    const callId = answeredToolCallId(ir as any);
    if (callId == null) continue;

    const violation = (problem: string) =>
      violations.push({ index: i, role: ir.role, callId, problem });

    const preceding = allCalls.filter(c => c.index < i && c.id === callId);
    if (preceding.length === 0) {
      const later = allCalls.filter(c => c.index > i && c.id === callId);
      violation(
        later.length > 0
          ? `answers a tool_call that only appears later in history (assistant at index ` +
              `${later.map(c => c.index).join(", ")}) — ordering violation`
          : "orphan: no assistant tool_call with this ID anywhere in history",
      );
      continue;
    }

    // The matching call must be the right kind for the answer: parse errors answer malformed
    // requests, everything else answers well-formed tool calls.
    if (ir.role === "tool-parse-error") {
      if (!preceding.some(c => c.callType === "malformed-tool-request")) {
        violation("no malformed-tool-request with this ID in any preceding assistant message");
      }
    } else if (!preceding.some(c => c.callType === "tool-call")) {
      violation("only malformed-tool-request entries with this ID in preceding assistant messages");
    }

    // lower() slices history at the most recent checkpoint: an output inside the tail whose only
    // matching call is before the checkpoint compiles into an orphan tool message.
    if (lastCheckpointIndex >= 0 && i > lastCheckpointIndex) {
      if (!preceding.some(c => c.index > lastCheckpointIndex)) {
        violation(
          `answered only before the most recent checkpoint (index ${lastCheckpointIndex}); ` +
            "checkpoint slicing orphans it at compile time",
        );
      }
    }
  }

  return violations;
}

/*
 * Repairs histories written by old versions of octo, which could drop the assistant message on
 * abort (e.g. aborting mid-diff-autofix emitted a tool-validation-error answer but sliced away
 * the assistant message carrying the tool call). The orphan answer would compile to a tool
 * message whose tool_call_id resolves to nothing, which strict backends reject on every resumed
 * request.
 *
 * Orphan answers are converted into user messages: a user message is always legal for any
 * backend, keeps the information visible to the model, and synthesizes no assistant history.
 * Only true orphans are repaired — answers whose tool call appears nowhere in history. Any
 * remaining violation is an unknown bug and is left for assertToolCallPairing to report loudly.
 */
export function repairOrphanedToolOutputs(history: readonly HistoryNode[]): HistoryNode[] {
  const requestedIds = new Set<string>();
  for (const item of history) {
    if (item.type !== "llm-ir" || item.ir.role !== "assistant") continue;
    for (const call of item.ir.toolCalls ?? []) {
      requestedIds.add(call.toolCallId);
    }
  }

  return history.map(item => {
    if (item.type !== "llm-ir") return item;
    const callId = answeredToolCallId(item.ir as any);
    if (callId == null || requestedIds.has(callId)) return item;
    return { ...item, ir: orphanAnswerToUserMessage(item.ir) };
  });
}

function orphanAnswerToUserMessage(ir: OctoIR): OctoIR {
  const lostCallNote =
    "Original note from octofriend: this message refers to a tool call whose assistant message " +
    "was lost, e.g. because octofriend was aborted mid-turn in an older version. " +
    "It is replayed here as a user message instead of a tool message.";

  switch (ir.role) {
    case "tool-output":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          { type: "text", content: `Output of the ${ir.toolCall.name} tool call:` },
          ...ir.content,
        ],
      };
    case "tool-skip-output":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          {
            type: "text",
            content: `The ${ir.toolCall.name} tool call was skipped and didn't run: ${ir.reason}`,
          },
        ],
      };
    case "tool-validation-error":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          {
            type: "text",
            content: `The ${ir.toolCall.name} tool call failed validation: ${ir.error}`,
          },
        ],
      };
    case "tool-runtime-error":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          { type: "text", content: `The ${ir.toolCall.name} tool call failed: ${ir.error}` },
        ],
      };
    case "tool-parse-error":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          { type: "text", content: `Malformed tool call: ${ir.malformedRequest.error}` },
        ],
      };
    case "tool-reject":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          { type: "text", content: `The ${ir.toolCall.name} tool call was rejected by the user.` },
        ],
      };
    case "file-read":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          { type: "text", content: `Contents of ${ir.path}:\n${ir.content}` },
        ],
      };
    case "file-mutate":
      return {
        role: "user",
        content: [
          { type: "text", content: lostCallNote },
          { type: "text", content: `The file ${ir.path} was modified.` },
        ],
      };
    default:
      return {
        role: "user",
        content: [{ type: "text", content: lostCallNote }],
      };
  }
}

export function assertToolCallPairing(history: readonly HistoryNode[]): void {
  const violations = findToolPairingViolations(history);
  if (violations.length === 0) return;
  const details = violations
    .slice(0, 10)
    .map(
      v =>
        `  - [index ${v.index}] ${v.role} (tool_call_id ${JSON.stringify(v.callId)}): ${v.problem}`,
    )
    .join("\n");
  const rest = violations.length > 10 ? `\n  ... and ${violations.length - 10} more` : "";
  throw new Error(
    `Session history contains ${violations.length} dangling tool output(s):\n${details}${rest}`,
  );
}
