import { describe, it, expect } from "vitest";
import { compactPrompt, CompactResponse, CompactSuccess, CompactFailure } from "../../prompts/compact-prompt.ts";

describe("compact-prompt", () => {
  describe("compactPrompt", () => {
    it("handles conversation with special characters", () => {
      const conversationHistory = `User: Test with "quotes" and <brackets>
Assistant: Response with special chars: & # $ %`;

      const prompt = compactPrompt(conversationHistory);

      expect(prompt).toContain(conversationHistory);
      expect(prompt).toContain('"quotes"');
      expect(prompt).toContain('<brackets>');
    });
  });

  describe("CompactResponse schema", () => {
    it("validates successful response", () => {
      const successResponse = {
        success: true,
        summary: "This is a test summary of the conversation.",
      };

      const result = CompactResponse.slice(successResponse);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.summary).toBe("This is a test summary of the conversation.");
      }
    });

    it("validates failure response", () => {
      const failureResponse = {
        success: false,
      };

      const result = CompactResponse.slice(failureResponse);

      expect(result.success).toBe(false);
    });

    it("validates CompactSuccess schema", () => {
      const successResponse = {
        success: true,
        summary: "Test summary",
      };

      const result = CompactSuccess.slice(successResponse);

      expect(result.success).toBe(true);
      expect(result.summary).toBe("Test summary");
    });

    it("validates CompactFailure schema", () => {
      const failureResponse = {
        success: false,
      };

      const result = CompactFailure.slice(failureResponse);

      expect(result.success).toBe(false);
    });

    it("handles response with extra fields", () => {
      const responseWithExtra = {
        success: true,
        summary: "Test summary",
        extraField: "This should be ignored",
      };

      const result = CompactResponse.slice(responseWithExtra);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.summary).toBe("Test summary");
      }
    });

    it("validates summary is a string", () => {
      const successResponse = {
        success: true,
        summary: "Valid string summary",
      };

      const result = CompactSuccess.slice(successResponse);

      expect(typeof result.summary).toBe("string");
      expect(result.summary.length).toBeGreaterThan(0);
    });
  });

  describe("prompt format for different conversation types", () => {
    it("formats conversation with tool calls", () => {
      const conversationHistory = `User: Read the file test.ts
[Tool call: Read]
[Tool result]
Assistant: Here's what I found in the file`;

      const prompt = compactPrompt(conversationHistory);

      expect(prompt).toContain("Tool call: Read");
      expect(prompt).toContain("Tool result");
    });

    it("formats conversation with code blocks", () => {
      const conversationHistory = `User: Write a function
Assistant: Here's the code:
\`\`\`typescript
function test() {
  return true;
}
\`\`\``;

      const prompt = compactPrompt(conversationHistory);

      expect(prompt).toContain("```typescript");
      expect(prompt).toContain("function test()");
    });

    it("formats conversation with multiple exchanges", () => {
      const conversationHistory = `User: Hello
        Assistant: Hi
        User: How are you?
        Assistant: Good
        User: What's the weather?
        Assistant: Sunny`;

      const prompt = compactPrompt(conversationHistory);

      expect(prompt).toContain("User: Hello");
      expect(prompt).toContain("Assistant: Hi");
      expect(prompt).toContain("User: How are you?");
      expect(prompt).toContain("User: What's the weather?");
    });

    it("formats conversation with notifications", () => {
      const conversationHistory = `User: Test command
Assistant: Running...
[Notification: Task completed successfully]`;

      const prompt = compactPrompt(conversationHistory);

      expect(prompt).toContain("Notification: Task completed successfully");
    });
  });

  describe("response validation edge cases", () => {
    it("rejects missing success field", () => {
      const invalidResponse = {
        summary: "Test summary",
      };

      // The schema should throw because success field is required
      expect(() => CompactResponse.slice(invalidResponse)).toThrow();
    });

    it("rejects null summary", () => {
      const responseWithNull = {
        success: true,
        summary: null,
      };

      // Schema validation should throw because summary must be a string
      expect(() => CompactResponse.slice(responseWithNull)).toThrow();
    });

    it("handles empty summary string", () => {
      const emptyResponse = {
        success: true,
        summary: "",
      };

      const result = CompactSuccess.slice(emptyResponse);

      expect(result.success).toBe(true);
      expect(result.summary).toBe("");
    });

    it("handles very long summary", () => {
      const longSummary = "A ".repeat(10000) + "very long summary";
      const longResponse = {
        success: true,
        summary: longSummary,
      };

      const result = CompactSuccess.slice(longResponse);

      expect(result.success).toBe(true);
      expect(result.summary.length).toBeGreaterThan(10000);
    });

    it("handles summary with newlines and special formatting", () => {
      const formattedSummary = `Summary line 1
        Summary line 2

        - Bullet point 1
        - Bullet point 2

        Final notes.`;

      const response = {
        success: true,
        summary: formattedSummary,
      };

      const result = CompactSuccess.slice(response);

      expect(result.success).toBe(true);
      expect(result.summary).toContain("Summary line 1");
      expect(result.summary).toContain("Bullet point 1");
      expect(result.summary).toContain("Final notes.");
    });
  });

  describe("prompt completeness", () => {
    it("prompt is comprehensive enough for LLM understanding", () => {
      const conversationHistory = "User: Test\nAssistant: Response";
      const prompt = compactPrompt(conversationHistory);

      // Check that the prompt has all necessary components
      const hasInstructions = prompt.includes("compact") || prompt.includes("summarize");
      const hasFormat = prompt.includes("JSON");
      const hasHistory = prompt.includes(conversationHistory);

      expect(hasInstructions).toBe(true);
      expect(hasFormat).toBe(true);
      expect(hasHistory).toBe(true);
    });

    it("prompt provides clear success/failure examples", () => {
      const conversationHistory = "Test";
      const prompt = compactPrompt(conversationHistory);

      expect(prompt).toContain("success");
      expect(prompt).toContain("summary");
    });
  });
});
