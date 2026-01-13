import { describe, it, expect } from "vitest";
import { findMostRecentCompactionCheckpointIndex } from "./autocompact.ts";
import { LlmIR } from "../ir/llm-ir.ts";

function userMessage(content: string): LlmIR {
  return {
    role: "user",
    content,
  };
}

function assistantMessage(content: string, tokenUsage: number = 10): LlmIR {
  return {
    role: "assistant",
    content,
    tokenUsage,
    outputTokens: tokenUsage,
  };
}

function checkpointMessage(summary: string): LlmIR {
  return {
    role: "compaction-checkpoint",
    summary,
  };
}

describe("autocompact.ts", () => {
  describe("findMostRecentCompactionCheckpointIndex", () => {
    describe("when there are no checkpoints", () => {
      const messages: LlmIR[] = [
        userMessage("Hello"),
        assistantMessage("Hi there"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      ];
      const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);

      it("should return 0", () => {
        expect(checkpointIndex).toBe(0);
      });

      it("slicing from index should return all messages", () => {
        const slicedMessages = messages.slice(checkpointIndex);
        expect(slicedMessages.length).toBe(4);
      });
    });

    describe("when there is one checkpoint", () => {
      const messages: LlmIR[] = [userMessage("Hello"), assistantMessage("Hi there")];
      const CHECKPOINT_INDEX = messages.length;
      messages.splice(
        CHECKPOINT_INDEX,
        0,
        checkpointMessage("Summary of early conversation"),
        userMessage("How are you?"),
        assistantMessage("I'm good"),
      );
      const EXPECTED_SLICED_LENGTH = messages.length - CHECKPOINT_INDEX;

      const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
      const slicedMessages = messages.slice(checkpointIndex);

      it("should return the checkpoint index", () => {
        expect(checkpointIndex).toBe(CHECKPOINT_INDEX);
      });

      it("slicing should include checkpoint and messages after it", () => {
        expect(slicedMessages.length).toBe(EXPECTED_SLICED_LENGTH);
      });

      it("sliced messages should include exactly one checkpoint", () => {
        const checkpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(checkpoints.length).toBe(1);
      });

      it("checkpoint should have the correct summary", () => {
        const checkpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(checkpoints[0].summary).toBe("Summary of early conversation");
      });
    });

    describe("when there are multiple checkpoints", () => {
      const messages: LlmIR[] = [
        userMessage("Message 1"),
        assistantMessage("Response 1", 5),
        checkpointMessage("First checkpoint"),
        userMessage("Message 2"),
        assistantMessage("Response 2", 5),
        userMessage("Message 3"),
        assistantMessage("Response 3", 5),
        checkpointMessage("Second checkpoint"),
        userMessage("Message 4"),
        assistantMessage("Response 4", 5),
      ];
      const THIRD_CHECKPOINT_INDEX = messages.length;
      messages.splice(
        messages.length,
        0,
        checkpointMessage("Third checkpoint"),
        userMessage("Message 5"),
        assistantMessage("Response 5", 5),
      );
      const EXPECTED_SLICED_LENGTH = messages.length - THIRD_CHECKPOINT_INDEX;

      const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
      const slicedMessages = messages.slice(checkpointIndex);

      it("should return the most recent checkpoint index", () => {
        expect(checkpointIndex).toBe(THIRD_CHECKPOINT_INDEX);
      });

      it("slicing should only include messages from last checkpoint onwards", () => {
        expect(slicedMessages.length).toBe(EXPECTED_SLICED_LENGTH);
      });

      it("sliced messages should include at most one checkpoint", () => {
        const checkpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(checkpoints.length).toBe(1);
      });

      it("checkpoint should be the most recent one", () => {
        const checkpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(checkpoints[0].summary).toBe("Third checkpoint");
      });

      it("should not include first checkpoint", () => {
        const allCheckpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(allCheckpoints.every(c => c.summary !== "First checkpoint")).toBe(true);
      });

      it("should not include second checkpoint", () => {
        const allCheckpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(allCheckpoints.every(c => c.summary !== "Second checkpoint")).toBe(true);
      });
    });

    describe("when filtering old messages", () => {
      const messages: LlmIR[] = [
        userMessage("Old message 1"),
        assistantMessage("Old response 1", 5),
      ];
      messages.splice(
        messages.length,
        0,
        checkpointMessage("Old checkpoint"),
        userMessage("Old message 2"),
        assistantMessage("Old response 2", 5),
      );
      const RECENT_CHECKPOINT_INDEX = messages.length;
      messages.splice(
        messages.length,
        0,
        checkpointMessage("Recent checkpoint"),
        userMessage("New message 1"),
        assistantMessage("New response 1", 5),
        userMessage("New message 2"),
        assistantMessage("New response 2", 5),
      );

      const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
      const slicedMessages = messages.slice(checkpointIndex);

      it("should return the most recent checkpoint index", () => {
        expect(checkpointIndex).toBe(RECENT_CHECKPOINT_INDEX);
      });

      it("sliced messages should only include new user messages after checkpoint", () => {
        const userMessages = slicedMessages.filter(m => m.role === "user");
        expect(userMessages.length).toBe(2);
      });

      it("all user messages should be new messages", () => {
        const userMessages = slicedMessages.filter(m => m.role === "user");
        expect(userMessages.every(m => m.content.includes("New"))).toBe(true);
      });
    });

    describe("when checkpoint is at the end", () => {
      const messages: LlmIR[] = [
        userMessage("Message 1"),
        assistantMessage("Response 1", 5),
        userMessage("Message 2"),
        assistantMessage("Response 2", 5),
      ];
      const CHECKPOINT_INDEX = messages.length;
      messages.splice(messages.length, 0, checkpointMessage("Latest checkpoint"));
      const EXPECTED_SLICED_LENGTH = messages.length - CHECKPOINT_INDEX;

      const checkpointIndex = findMostRecentCompactionCheckpointIndex(messages);
      const slicedMessages = messages.slice(checkpointIndex);

      it("should return the checkpoint index", () => {
        expect(checkpointIndex).toBe(CHECKPOINT_INDEX);
      });

      it("slicing should only contain the checkpoint", () => {
        expect(slicedMessages.length).toBe(EXPECTED_SLICED_LENGTH);
      });

      it("checkpoint should have the correct summary", () => {
        const checkpoints = slicedMessages.filter(m => m.role === "compaction-checkpoint");
        expect(checkpoints[0].summary).toBe("Latest checkpoint");
      });
    });
  });
});
