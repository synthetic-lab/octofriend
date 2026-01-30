import { describe, it, expect } from "vitest";
import { toLlmIR, outputToHistory } from "./convert-history-ir.ts";
import { HistoryItem, sequenceId } from "../history.ts";

describe("toLlmIR", () => {
  it("filters out plan-written items", () => {
    const history: HistoryItem[] = [
      { type: "user", id: sequenceId(), content: "create a plan" },
      {
        type: "assistant",
        id: sequenceId(),
        content: "Here is the plan",
        tokenUsage: 10,
        outputTokens: 5,
      },
      {
        type: "plan-written",
        id: sequenceId(),
        planFilePath: "/plans/test.md",
        content: "# Plan\nStep 1",
      },
      { type: "user", id: sequenceId(), content: "looks good" },
    ];

    const ir = toLlmIR(history);

    // plan-written items should be filtered out (lowered to null)
    const roles = ir.map(item => item.role);
    expect(roles).not.toContain("plan-written");
    // Should still have user and assistant messages
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("filters out notification items", () => {
    const history: HistoryItem[] = [
      { type: "user", id: sequenceId(), content: "hello" },
      { type: "notification", id: sequenceId(), content: "Model switched" },
      {
        type: "assistant",
        id: sequenceId(),
        content: "Hi there",
        tokenUsage: 5,
        outputTokens: 3,
      },
    ];

    const ir = toLlmIR(history);
    const roles = ir.map(item => item.role);
    expect(roles).toEqual(["user", "assistant"]);
  });

  it("handles write-plan tool output in collapseToIR", () => {
    const history: HistoryItem[] = [
      { type: "user", id: sequenceId(), content: "plan this feature" },
      {
        type: "assistant",
        id: sequenceId(),
        content: "I'll write a plan",
        tokenUsage: 10,
        outputTokens: 5,
      },
      {
        type: "tool",
        id: sequenceId(),
        tool: {
          type: "function",
          toolCallId: "call-1",
          function: {
            name: "write-plan",
            arguments: { content: "# Plan" },
          },
        },
      },
      {
        type: "tool-output",
        id: sequenceId(),
        result: { content: "Plan written successfully" },
        toolCallId: "call-1",
      },
    ];

    const ir = toLlmIR(history);

    // The tool-output for write-plan should produce a tool-output IR
    const toolOutput = ir.find(item => item.role === "tool-output");
    expect(toolOutput).toBeDefined();
    if (toolOutput && toolOutput.role === "tool-output") {
      expect(toolOutput.content).toBe("Plan written successfully");
    }
  });
});

describe("outputToHistory", () => {
  it("converts assistant output IR to history items", () => {
    const output = [
      {
        role: "assistant" as const,
        content: "Hello",
        tokenUsage: 10,
        outputTokens: 5,
      },
    ];

    const history = outputToHistory(output);
    expect(history).toHaveLength(1);
    expect(history[0].type).toBe("assistant");
  });
});
