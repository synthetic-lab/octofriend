import { describe, expect, it } from "bun:test";
import {
  assertToolCallPairing,
  findToolPairingViolations,
  repairOrphanedToolOutputs,
} from "./tool-pairing.ts";
import type { HistoryNode } from "./index.ts";
import { compilerUsage } from "../libocto/compilers/compiler-interface.ts";
import type { ToolCall } from "../libocto/tool-def.ts";
import type { OctoIR } from "../ir/octo-ir.ts";
import type toolMap from "../tools/tool-defs/index.ts";

type ShellToolCall = Extract<ToolCall<typeof toolMap>, { name: "shell" }>;

let nextNodeId = 1;

function node(ir: OctoIR): HistoryNode {
  return { type: "llm-ir", nodeId: nextNodeId++, modelJson: null, ir };
}

function shellCall(id: string, cmd: string): ShellToolCall {
  return {
    type: "tool-call",
    name: "shell",
    toolCallId: id,
    original: { cmd, timeout: 60_000 },
    parsed: { cmd, timeout: 60_000 },
  };
}

function assistantNode(calls: ShellToolCall[]): HistoryNode {
  return node({
    role: "assistant",
    content: "On it.",
    usage: compilerUsage(0, 0),
    toolCalls: calls,
  });
}

function toolOutputNode(call: ShellToolCall): HistoryNode {
  return node({
    role: "tool-output",
    toolCall: call,
    content: [{ type: "text", content: "done" }],
  });
}

function toolValidationErrorNode(call: ShellToolCall): HistoryNode {
  return node({
    role: "tool-validation-error",
    toolCall: call,
    error: "invalid arguments",
    aborted: false,
  });
}

function expectRepairedToUser(
  item: HistoryNode,
): HistoryNode & { type: "llm-ir"; ir: Extract<OctoIR, { role: "user" }> } {
  if (item.type !== "llm-ir" || item.ir.role !== "user") {
    throw new Error(`Expected a user message, got ${JSON.stringify(item)}`);
  }
  return item as HistoryNode & { type: "llm-ir"; ir: Extract<OctoIR, { role: "user" }> };
}

describe("repairOrphanedToolOutputs", () => {
  it("leaves well-ordered tool call/answer pairs untouched", () => {
    const callA = shellCall("shell:1", "echo a");
    const callB = shellCall("shell:2", "echo b");
    const history = [
      assistantNode([callA, callB]),
      toolOutputNode(callA),
      toolValidationErrorNode(callB),
    ];

    expect(repairOrphanedToolOutputs(history)).toEqual(history);
    expect(() => assertToolCallPairing(history)).not.toThrow();
  });

  it("repairs an orphan answer whose call appears nowhere in history", () => {
    const history = [toolValidationErrorNode(shellCall("shell:9", "echo lost"))];

    const repaired = repairOrphanedToolOutputs(history);
    expect(repaired).toHaveLength(1);
    const userItem = expectRepairedToUser(repaired[0]);
    expect(userItem.ir.role).toBe("user");
    expect(() => assertToolCallPairing(repaired)).not.toThrow();
  });

  /*
   * Regression test: providers recycle tool call IDs across turns (e.g. per-response counters
   * like edit:215). When an old dangled answer's ID is later reused by an unrelated assistant
   * turn, the recycled call can't pair with the earlier answer: answers compile to tool messages
   * that must resolve to a preceding tool_call, and the recycled call precedes none of them it
   * didn't request. The stale answer must still be repaired, and the recycled pair left alone.
   */
  it("repairs an orphan answer whose ID is recycled by a later call", () => {
    const orphan = toolValidationErrorNode(shellCall("edit:215", "echo orphaned"));
    const recycledCall = shellCall("edit:215", "echo recycled");
    const recycledOther = shellCall("edit:216", "echo also recycled");
    const history = [
      orphan,
      assistantNode([recycledCall, recycledOther]),
      toolOutputNode(recycledCall),
      toolOutputNode(recycledOther),
    ];

    // Pre-repair, the recycled ID hides the orphan from anywhere-in-history checks: the only
    // detectable violation is ordering.
    const violations = findToolPairingViolations(history);
    expect(violations).toHaveLength(1);
    expect(violations[0].problem).toContain("ordering violation");

    const repaired = repairOrphanedToolOutputs(history);
    expect(repaired).toHaveLength(4);

    // The orphan answer becomes a user message mentioning the failure.
    const userItem = expectRepairedToUser(repaired[0]);
    expect(userItem.ir.role).toBe("user");
    const text = userItem.ir.content
      .map(part => (part.type === "text" ? part.content : ""))
      .join("\n");
    expect(text).toContain("invalid arguments");

    // The recycled call/answer pairs are untouched.
    expect(repaired[1].type === "llm-ir" && repaired[1].ir.role).toBe("assistant");
    expect(repaired[2].type === "llm-ir" && repaired[2].ir.role).toBe("tool-output");
    expect(repaired[3].type === "llm-ir" && repaired[3].ir.role).toBe("tool-output");

    expect(() => assertToolCallPairing(repaired)).not.toThrow();
  });

  it("leaves a recycled ID's answers paired with an earlier call untouched", () => {
    const first = shellCall("call_0", "echo first");
    const second = shellCall("call_0", "echo second");
    const history = [
      assistantNode([first]),
      toolOutputNode(first),
      assistantNode([second]),
      toolOutputNode(second),
    ];

    expect(repairOrphanedToolOutputs(history)).toEqual(history);
    expect(() => assertToolCallPairing(history)).not.toThrow();
  });
});
