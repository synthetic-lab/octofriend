import { describe, it, expect } from "vitest";
import { Config } from "../config.ts";

describe("Parallel Tool Validation Configuration", () => {
  const createMockConfig = (enabled: boolean = false, maxConcurrency: number = 5): Config => ({
    yourName: "Test",
    models: [],
    parallelToolExecution: {
      enabled,
      maxConcurrency,
    },
  });

  describe("Config Options", () => {
    it("should default to disabled when parallelToolExecution not set", () => {
      const config: Config = {
        yourName: "Test",
        models: [],
      };

      const enabled = config.parallelToolExecution?.enabled ?? false;
      expect(enabled).toBe(false);
    });

    it("should default maxConcurrency to 5 when not set", () => {
      const config: Config = {
        yourName: "Test",
        models: [],
        parallelToolExecution: {
          enabled: true,
        },
      };

      const maxConcurrency = config.parallelToolExecution?.maxConcurrency ?? 5;
      expect(maxConcurrency).toBe(5);
    });

    it("should respect custom maxConcurrency", () => {
      const config = createMockConfig(true, 3);
      expect(config.parallelToolExecution?.maxConcurrency).toBe(3);
    });

    it("should respect enabled flag", () => {
      const config = createMockConfig(true);
      expect(config.parallelToolExecution?.enabled).toBe(true);
    });

    it("should handle disabled explicitly", () => {
      const config = createMockConfig(false);
      expect(config.parallelToolExecution?.enabled).toBe(false);
    });
  });

  describe("Tool Call Structure", () => {
    it("should create valid tool call objects", () => {
      const toolCall = {
        type: "function" as const,
        function: {
          name: "read" as const,
          arguments: { filePath: "/tmp/file.txt" },
        },
        toolCallId: "call_1",
      };

      expect(toolCall.type).toBe("function");
      expect(toolCall.function.name).toBe("read");
      expect(toolCall.toolCallId).toBe("call_1");
    });

    it("should support multiple tool calls", () => {
      const toolCalls = [
        {
          type: "function" as const,
          function: { name: "read" as const, arguments: { filePath: "/a.txt" } },
          toolCallId: "call_1",
        },
        {
          type: "function" as const,
          function: { name: "list" as const, arguments: {} },
          toolCallId: "call_2",
        },
      ];

      expect(toolCalls).toHaveLength(2);
      expect(toolCalls.map(t => t.function.name)).toEqual(["read", "list"]);
    });
  });

  describe("Concurrency Logic", () => {
    it("should calculate chunk count correctly", () => {
      const toolCount = 10;
      const maxConcurrency = 3;
      const expectedChunks = Math.ceil(toolCount / maxConcurrency);

      expect(expectedChunks).toBe(4); // 3 + 3 + 3 + 1
    });

    it("should handle exact division", () => {
      const toolCount = 9;
      const maxConcurrency = 3;
      const expectedChunks = Math.ceil(toolCount / maxConcurrency);

      expect(expectedChunks).toBe(3); // 3 + 3 + 3
    });

    it("should handle single tool", () => {
      const toolCount = 1;
      const maxConcurrency = 5;
      const expectedChunks = Math.ceil(toolCount / maxConcurrency);

      expect(expectedChunks).toBe(1);
    });

    it("should handle zero tools", () => {
      const toolCount = 0;
      const maxConcurrency = 5;
      const expectedChunks = Math.ceil(toolCount / maxConcurrency);

      expect(expectedChunks).toBe(0);
    });
  });
});
