import { describe, it, expect } from "vitest";
import { shouldCompactHistory, formatHistoryForSummary } from "../../../source/compilers/autocompact.ts";
import { Config } from "../../../source/config.ts";
import { HistoryItem } from "../../../source/history.ts";

describe("autocompact", () => {
  const mockConfig: Config = {
    yourName: "Test User",
    models: [
      {
        nickname: "Test Model",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4",
        context: 128000,
      },
    ],
    autoCompact: {
      enabled: true,
      tokenThreshold: 50000,
    },
  };

  describe("shouldCompactHistory", () => {
    it("returns false when autoCompact is not enabled", () => {
      const config = { ...mockConfig, autoCompact: undefined };
      const history: HistoryItem[] = [];

      expect(shouldCompactHistory(history, config)).toBe(false);
    });

    it("returns false when autoCompact is disabled", () => {
      const config = {
        ...mockConfig,
        autoCompact: { enabled: false, tokenThreshold: 50000 },
      };
      const history: HistoryItem[] = [];

      expect(shouldCompactHistory(history, config)).toBe(false);
    });

    it("returns false when token count is below threshold", () => {
      const history: HistoryItem[] = [
        {
          type: "user",
          id: 1n,
          content: "Hello",
        },
        {
          type: "assistant",
          id: 2n,
          content: "Hi there!",
          tokenUsage: 100,
          outputTokens: 10,
        },
      ];

      expect(shouldCompactHistory(history, mockConfig)).toBe(false);
    });

    it("returns true when token count exceeds threshold", () => {
      // Create a large conversation that will exceed threshold
      const history: HistoryItem[] = [];

      // Add many messages to exceed token threshold
      for (let i = 0; i < 100; i++) {
        history.push({
          type: "user",
          id: BigInt(i * 2),
          content: "This is a test message that has some content to contribute to the token count. ".repeat(10),
        });
        history.push({
          type: "assistant",
          id: BigInt(i * 2 + 1),
          content: "This is a test response with substantial content that will add to the overall token count. ".repeat(10),
          tokenUsage: 500,
          outputTokens: 100,
        });
      }

      const config = {
        ...mockConfig,
        autoCompact: { enabled: true, tokenThreshold: 1000 },
      };

      expect(shouldCompactHistory(history, config)).toBe(true);
    });
  });


  describe("formatHistoryForSummary", () => {
    it("formats different message types correctly", () => {
      const history: HistoryItem[] = [
        {
          type: "user",
          id: 1n,
          content: "User message",
        },
        {
          type: "assistant",
          id: 2n,
          content: "Assistant message",
          tokenUsage: 100,
          outputTokens: 10,
        },
        {
          type: "tool",
          id: 3n,
          tool: {
            type: "function",
            function: {
              name: "read",
              arguments: { filePath: "test.ts" },
            },
            toolCallId: "tool_123",
          },
        },
        {
          type: "tool-output",
          id: 4n,
          toolCallId: "tool_123",
          result: {
            content: "File contents",
          },
        },
        {
          type: "notification",
          id: 5n,
          content: "Test notification",
        },
      ];

      const formatted = formatHistoryForSummary(history);

      // Verify it includes user and assistant messages with type prefix
      expect(formatted).toContain("user: ");
      expect(formatted).toContain("User message");
      expect(formatted).toContain("assistant: ");
      expect(formatted).toContain("Assistant message");

      // Verify it includes tool information with type as the prefix
      expect(formatted).toContain("tool: ");
      expect(formatted).toContain("read");
      expect(formatted).toContain("tool-output: ");
      expect(formatted).toContain("File contents");
    });

    it("formats compact summary items", () => {
      const history: HistoryItem[] = [
        {
          type: "compact-summary",
          id: 1n,
          content: "This is a previous summary",
          tokensBeforeCompact: 5000,
          tokensAfterCompact: 500,
        },
        {
          type: "user",
          id: 2n,
          content: "New message",
        },
      ];

      const formatted = formatHistoryForSummary(history);

      expect(formatted).toContain("compact-summary: ");
      expect(formatted).toContain("This is a previous summary");
      expect(formatted).toContain("user: ");
      expect(formatted).toContain("New message");
    });

    it("handles empty history", () => {
      const history: HistoryItem[] = [];
      const formatted = formatHistoryForSummary(history);
      expect(formatted).toBe("");
    });
  });

  describe("edge cases", () => {
    it("handles empty history", () => {
      const history: HistoryItem[] = [];

      expect(shouldCompactHistory(history, mockConfig)).toBe(false);
    });

    it("handles history with single message", () => {
      const history: HistoryItem[] = [
        {
          type: "user",
          id: 1n,
          content: "Single message",
        },
      ];

      // Single message shouldn't trigger compaction
      expect(shouldCompactHistory(history, mockConfig)).toBe(false);
    });
  });
});
