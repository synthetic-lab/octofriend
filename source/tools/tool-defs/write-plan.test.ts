import { describe, it, expect, vi } from "vitest";
import writePlanTool from "./write-plan.ts";
import { ToolError } from "../common.ts";
import type { Transport } from "../../transports/transport-common.ts";
import type { Config } from "../../config.ts";

function createMockTransport(overrides?: Partial<Transport>): Transport {
  return {
    shell: vi.fn(),
    mkdir: vi.fn(),
    pathExists: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    isDirectory: vi.fn(),
    readdir: vi.fn(),
    modTime: vi.fn(),
    resolvePath: vi.fn(),
    cwd: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function createMockConfig(): Config {
  return {
    yourName: "test",
    models: [],
  } as Config;
}

describe("write-plan tool", () => {
  describe("factory", () => {
    it("returns null when planFilePath is null", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;

      const result = await writePlanTool(signal, transport, config, null);

      expect(result).toBeNull();
    });

    it("returns null when planFilePath is empty string", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;

      const result = await writePlanTool(signal, transport, config, "");

      expect(result).toBeNull();
    });

    it("returns ToolDef when planFilePath is provided", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;

      const result = await writePlanTool(signal, transport, config, ".plans/test.md");

      expect(result).not.toBeNull();
      expect(result).toHaveProperty("Schema");
      expect(result).toHaveProperty("ArgumentsSchema");
      expect(result).toHaveProperty("validate");
      expect(result).toHaveProperty("run");
    });
  });

  describe("run", () => {
    it("calls transport.writeFile with correct arguments", async () => {
      const writeFileMock = vi.fn().mockResolvedValue(undefined);
      const transport = createMockTransport({ writeFile: writeFileMock });
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "# Test Plan",
        },
      };

      await tool!.run(signal, transport, call, config, null);

      expect(writeFileMock).toHaveBeenCalledWith(signal, planFilePath, "# Test Plan");
    });

    it("returns content and line count on success", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "# Test Plan",
        },
      };

      const result = await tool!.run(signal, transport, call, config, null);

      expect(result).toEqual({
        content: "# Test Plan",
        lines: 1,
      });
    });

    it("returns correct line count for multi-line content", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const content = "# Test Plan\n\n## Goal\nTest the write-plan tool";
      const call = {
        name: "write-plan" as const,
        arguments: { content },
      };

      const result = await tool!.run(signal, transport, call, config, null);

      expect(result.lines).toBe(4);
    });

    it("returns correct line count for single-line content", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "Single line",
        },
      };

      const result = await tool!.run(signal, transport, call, config, null);

      expect(result.lines).toBe(1);
    });

    it("returns correct line count for empty content", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "",
        },
      };

      const result = await tool!.run(signal, transport, call, config, null);

      expect(result.lines).toBe(1);
    });

    it("returns correct line count for content with trailing newline", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "Line 1\nLine 2\n",
        },
      };

      const result = await tool!.run(signal, transport, call, config, null);

      expect(result.lines).toBe(3);
    });

    it("wraps write errors in ToolError", async () => {
      const writeError = new Error("Permission denied");
      const writeFileMock = vi.fn().mockRejectedValue(writeError);
      const transport = createMockTransport({ writeFile: writeFileMock });
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "# Test Plan",
        },
      };

      await expect(tool!.run(signal, transport, call, config, null)).rejects.toThrow(ToolError);
    });

    it("includes plan file path in error message", async () => {
      const writeError = new Error("Permission denied");
      const writeFileMock = vi.fn().mockRejectedValue(writeError);
      const transport = createMockTransport({ writeFile: writeFileMock });
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "# Test Plan",
        },
      };

      await expect(tool!.run(signal, transport, call, config, null)).rejects.toThrow(
        `Failed to write plan file ${planFilePath}`,
      );
    });
  });

  describe("validate", () => {
    it("returns null for valid arguments", async () => {
      const transport = createMockTransport();
      const config = createMockConfig();
      const signal = new AbortController().signal;
      const planFilePath = ".plans/test.md";

      const tool = await writePlanTool(signal, transport, config, planFilePath);
      expect(tool).not.toBeNull();

      const call = {
        name: "write-plan" as const,
        arguments: {
          content: "# Test Plan",
        },
      };

      const result = await tool!.validate(signal, transport, call, config);

      expect(result).toBeNull();
    });
  });
});
