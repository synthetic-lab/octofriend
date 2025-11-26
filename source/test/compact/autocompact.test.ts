import { describe, it, expect } from "vitest";
import { formatMessagesForSummary, processCompactedHistory } from "../../../source/compilers/autocompact.ts";
import { LlmIR, toLlmIR } from "../../../source/ir/llm-ir.ts";
import { AgentResult } from "../../../source/ir/llm-ir.ts";
import { sequenceId } from "../../../source/history.ts";

describe("autocompact", () => {
  describe("formatMessagesForSummary", () => {
    it("formats LlmIR messages for summary generation", () => {
      const messages: LlmIR[] = [
        {
          role: "user",
          content: "User message",
        },
        {
          role: "assistant", 
          content: "Assistant message",
          reasoningContent: undefined,
          openai: undefined,
          anthropic: undefined,
          tokenUsage: 0,
          outputTokens: 0,
        }
      ];

      const result = formatMessagesForSummary(messages);
      
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("user");
      if (result[0].role === "user") {
        expect(result[0].content).toContain("user:");
      }
    });

    it("handles empty messages array", () => {
      const messages: LlmIR[] = [];
      const result = formatMessagesForSummary(messages);
      
      expect(result).toHaveLength(1);
    });
  });

  describe("processCompactedHistory", () => {
    it("processes successful agent result with summary", () => {
      const agentResult: AgentResult = {
        success: true,
        output: [
          {
            role: "assistant",
            content: '{"success": true, "summary": "This is the summary"}',
            tokenUsage: 10,
            outputTokens: 10,
          }
        ]
      };

      const result = processCompactedHistory(agentResult);
      expect(result).toBe("This is the summary");
    });

    it("returns undefined for successful result without assistant message", () => {
      const agentResult: AgentResult = {
        success: true,
        output: []
      };

      const result = processCompactedHistory(agentResult);
      expect(result).toBeUndefined();
    });

    it("returns undefined for failed agent result", () => {
      const agentResult: AgentResult = {
        success: false,
        requestError: "API error",
        curl: "curl command"
      };

      const result = processCompactedHistory(agentResult);
      expect(result).toBeUndefined();
    });

    it("returns undefined for invalid JSON in assistant response", () => {
      const agentResult: AgentResult = {
        success: true,
        output: [
          {
            role: "assistant",
            content: "invalid json",
            tokenUsage: 1,
            outputTokens: 1,
          }
        ]
      };

      const result = processCompactedHistory(agentResult);
      expect(result).toBeUndefined();
    });
  });
});
