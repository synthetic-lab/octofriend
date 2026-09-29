import { describe, expect, it } from "bun:test";
import { t } from "structural";
import type { CheckpointedIRWithTrajectories, Content, LoweredIR, PreLoweredIR } from "./llm-ir.ts";
import { definePermissionedAgent } from "./llm-ir.ts";
import { lower } from "./lower.ts";
import { ok } from "./result.ts";
import { ToolBuilder } from "./tool-def.ts";

const searchTool = new ToolBuilder<unknown>()
  .declare({
    name: "search",
    description: "Searches the web",
    ArgumentsSchema: t.subtype({ query: t.str }),
  })
  .define(async () => ({
    run: async () => ok({ type: "output" as const, content: [] }),
  }));

const _testAgent = definePermissionedAgent({
  tools: { search: searchTool },
  agents: {},
});
type TestAgent = typeof _testAgent;

type TestIR = CheckpointedIRWithTrajectories<TestAgent>;
type TestLoweredIR = LoweredIR<TestAgent["tools"]>;

function userMessage(content: string): TestIR {
  return {
    role: "user",
    content: [{ type: "text", content }],
  };
}

function assistantMessage(content: string, tokenUsage: number = 10): TestIR {
  return {
    role: "assistant",
    content,
    usage: {
      input: {
        cached: 0,
        uncached: tokenUsage,
        total: tokenUsage,
      },
      output: 0,
    },
  };
}

function checkpointMessage(summary: string): TestIR {
  return {
    role: "checkpoint",
    content: [{ type: "text", content: summary }],
  };
}

function checkpointSummary(message: TestIR | TestLoweredIR): string {
  if (message.role !== "checkpoint" && message.role !== "lowered-checkpoint") {
    throw new Error("Expected checkpoint");
  }
  return contentToText(message.content);
}

function userText(message: TestIR): string {
  if (message.role !== "user") throw new Error("Expected user message");
  return contentToText(message.content);
}

function contentToText(content: Content["content"]): string {
  return content
    .map(part => {
      if (part.type === "text") return part.content;
      return `Image file: ${part.image.filePath}`;
    })
    .join("\n");
}

function roles(messages: Array<{ role: string }>): string[] {
  return messages.map(m => m.role);
}

describe("lower", () => {
  it("passes through lowered IR", () => {
    const messages: TestIR[] = [userMessage("hello")];

    expect(lower<TestAgent>(messages)).toEqual<TestIR[]>(messages);
  });

  it("throws when a trajectory reaches the default lowering path", () => {
    const trajectory = { role: "trajectory" } as CheckpointedIRWithTrajectories<TestAgent>;

    expect(() => lower<TestAgent>([trajectory])).toThrow(
      "Subagent trajectory lowering is not implemented yet",
    );
  });

  describe("checkpoint slicing", () => {
    it("keeps all messages when there are no checkpoints", () => {
      const messages: TestIR[] = [
        userMessage("Hello"),
        assistantMessage("Hi there"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      ];

      expect(lower<TestAgent>(messages)).toEqual<TestIR[]>(messages);
    });

    it("keeps a single checkpoint and following messages", () => {
      const messages: TestIR[] = [
        userMessage("Hello"),
        assistantMessage("Hi there"),
        checkpointMessage("Summary of early conversation"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      ];

      const lowered = lower<TestAgent>(messages);

      expect(lowered.length).toBe(3);
      expect(lowered.filter(m => m.role === "lowered-checkpoint").length).toBe(1);
      expect(roles(lowered)).not.toContain("checkpoint");
      expect(checkpointSummary(lowered[0])).toBe("Summary of early conversation");
    });

    it("keeps only the most recent checkpoint and following messages", () => {
      const messages: TestIR[] = [
        userMessage("Message 1"),
        assistantMessage("Response 1", 5),
        checkpointMessage("First checkpoint"),
        userMessage("Message 2"),
        assistantMessage("Response 2", 5),
        checkpointMessage("Second checkpoint"),
        userMessage("Message 3"),
        assistantMessage("Response 3", 5),
        checkpointMessage("Third checkpoint"),
        userMessage("Message 4"),
        assistantMessage("Response 4", 5),
      ];

      const lowered = lower<TestAgent>(messages);

      expect(lowered.length).toBe(3);
      expect(lowered.filter(m => m.role === "lowered-checkpoint").length).toBe(1);
      expect(roles(lowered)).not.toContain("checkpoint");
      expect(checkpointSummary(lowered[0])).toBe("Third checkpoint");
      expect(
        lowered.every(
          m => m.role !== "lowered-checkpoint" || checkpointSummary(m) !== "First checkpoint",
        ),
      ).toBe(true);
      expect(
        lowered.every(
          m => m.role !== "lowered-checkpoint" || checkpointSummary(m) !== "Second checkpoint",
        ),
      ).toBe(true);
    });

    it("only keeps new user messages after the latest checkpoint", () => {
      const messages: TestIR[] = [
        userMessage("Old message 1"),
        assistantMessage("Old response 1", 5),
        checkpointMessage("Old checkpoint"),
        userMessage("Old message 2"),
        assistantMessage("Old response 2", 5),
        checkpointMessage("Recent checkpoint"),
        userMessage("New message 1"),
        assistantMessage("New response 1", 5),
        userMessage("New message 2"),
        assistantMessage("New response 2", 5),
      ];

      const lowered = lower<TestAgent>(messages);
      const userMessages = lowered.filter(m => m.role === "user");

      expect(userMessages.length).toBe(2);
      expect(userMessages.every(m => userText(m).includes("New"))).toBe(true);
    });

    it("keeps the checkpoint when the checkpoint is at the end", () => {
      const messages: TestIR[] = [
        userMessage("Message 1"),
        assistantMessage("Response 1", 5),
        userMessage("Message 2"),
        assistantMessage("Response 2", 5),
        checkpointMessage("Latest checkpoint"),
      ];

      const lowered = lower<TestAgent>(messages);

      expect(lowered.length).toBe(1);
      expect(checkpointSummary(lowered[0])).toBe("Latest checkpoint");
    });
  });

  it("lowers a tool-reject to a skip output", () => {
    const messages: Array<PreLoweredIR<TestAgent>> = [
      assistantMessage("Searching for something"),
      {
        role: "tool-reject",
        toolCall: {
          type: "tool-call",
          name: "search",
          toolCallId: "call-1",
          original: { query: "embarrassing search history" },
          parsed: { query: "embarrassing search history" },
        },
      },
      userMessage("Please don't search for that"),
    ];

    const lowered = lower<TestAgent>(messages);

    expect(roles(lowered)).toEqual(["assistant", "tool-skip-output", "user"]);
    const skip = lowered[1];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.toolCall.toolCallId).toBe("call-1");
    expect(skip.reason).toBe("Tool call rejected by user.");
  });
});
