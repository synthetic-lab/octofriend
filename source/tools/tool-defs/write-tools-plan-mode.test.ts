import { describe, it, expect, vi, beforeEach } from "vitest";
import edit from "./edit.ts";
import create from "./create.ts";
import append from "./append.ts";
import prepend from "./prepend.ts";
import rewrite from "./rewrite.ts";
import bash from "./bash.ts";
import { createPlanModeToolResult, PLAN_MODE_MESSAGE } from "../common.ts";
import type { Transport } from "../../transports/transport-common.ts";
import type { Config } from "../../config.ts";

function createMockTransport(overrides?: Partial<Transport>): Transport {
  return {
    shell: vi.fn().mockResolvedValue(""),
    mkdir: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(true),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    isDirectory: vi.fn().mockResolvedValue(false),
    readdir: vi.fn().mockResolvedValue([]),
    modTime: vi.fn().mockResolvedValue(Date.now()),
    resolvePath: vi.fn().mockResolvedValue("/test/path"),
    cwd: vi.fn().mockResolvedValue("/test"),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockConfig(): Config {
  return {
    yourName: "test",
    models: [],
  } as Config;
}

describe("write tools in plan mode", () => {
  const signal = new AbortController().signal;
  let transport: Transport;
  let config: Config;

  beforeEach(() => {
    transport = createMockTransport();
    config = createMockConfig();
  });

  describe("edit tool", () => {
    it("returns plan mode message when planFilePath is provided", async () => {
      const tool = await edit(signal, transport, config, "/plans/test.md");
      const result = await tool!.run(
        signal,
        transport,
        {
          name: "edit",
          arguments: {
            filePath: "/test/file.txt",
            search: "old",
            replace: "new",
          },
        },
        config,
        null,
      );

      expect(result).toEqual(createPlanModeToolResult());
      expect(result.content).toBe(PLAN_MODE_MESSAGE);
    });

    it("returns plan mode message with correct tool schema when planFilePath is provided", async () => {
      const tool = await edit(signal, transport, config, "/plans/test.md");
      expect(tool).toHaveProperty("Schema");
      expect(tool).toHaveProperty("ArgumentsSchema");
      expect(tool).toHaveProperty("validate");
      expect(tool).toHaveProperty("run");

      // Validate should return null (no validation needed in plan mode)
      const validateResult = await tool!.validate(
        signal,
        transport,
        {
          name: "edit",
          arguments: {
            filePath: "/test/file.txt",
            search: "old",
            replace: "new",
          },
        },
        config,
      );
      expect(validateResult).toBeNull();
    });
  });

  describe("create tool", () => {
    it("returns plan mode message when planFilePath is provided", async () => {
      const tool = await create(signal, transport, config, "/plans/test.md");
      const result = await tool!.run(
        signal,
        transport,
        {
          name: "create",
          arguments: {
            filePath: "/test/file.txt",
            content: "new content",
          },
        },
        config,
        null,
      );

      expect(result).toEqual(createPlanModeToolResult());
      expect(result.content).toBe(PLAN_MODE_MESSAGE);
    });

    it("returns plan mode message with correct tool schema when planFilePath is provided", async () => {
      const tool = await create(signal, transport, config, "/plans/test.md");
      expect(tool).toHaveProperty("Schema");
      expect(tool).toHaveProperty("ArgumentsSchema");
      expect(tool).toHaveProperty("validate");
      expect(tool).toHaveProperty("run");

      // Validate should return null (no validation needed in plan mode)
      const validateResult = await tool!.validate(
        signal,
        transport,
        {
          name: "create",
          arguments: {
            filePath: "/test/file.txt",
            content: "new content",
          },
        },
        config,
      );
      expect(validateResult).toBeNull();
    });
  });

  describe("append tool", () => {
    it("returns plan mode message when planFilePath is provided", async () => {
      const tool = await append(signal, transport, config, "/plans/test.md");
      const result = await tool!.run(
        signal,
        transport,
        {
          name: "append",
          arguments: {
            filePath: "/test/file.txt",
            text: "appended text",
          },
        },
        config,
        null,
      );

      expect(result).toEqual(createPlanModeToolResult());
      expect(result.content).toBe(PLAN_MODE_MESSAGE);
    });

    it("returns plan mode message with correct tool schema when planFilePath is provided", async () => {
      const tool = await append(signal, transport, config, "/plans/test.md");
      expect(tool).toHaveProperty("Schema");
      expect(tool).toHaveProperty("ArgumentsSchema");
      expect(tool).toHaveProperty("validate");
      expect(tool).toHaveProperty("run");

      // Validate should return null (no validation needed in plan mode)
      const validateResult = await tool!.validate(
        signal,
        transport,
        {
          name: "append",
          arguments: {
            filePath: "/test/file.txt",
            text: "appended text",
          },
        },
        config,
      );
      expect(validateResult).toBeNull();
    });
  });

  describe("prepend tool", () => {
    it("returns plan mode message when planFilePath is provided", async () => {
      const tool = await prepend(signal, transport, config, "/plans/test.md");
      const result = await tool!.run(
        signal,
        transport,
        {
          name: "prepend",
          arguments: {
            filePath: "/test/file.txt",
            text: "prepended text",
          },
        },
        config,
        null,
      );

      expect(result).toEqual(createPlanModeToolResult());
      expect(result.content).toBe(PLAN_MODE_MESSAGE);
    });

    it("returns plan mode message with correct tool schema when planFilePath is provided", async () => {
      const tool = await prepend(signal, transport, config, "/plans/test.md");
      expect(tool).toHaveProperty("Schema");
      expect(tool).toHaveProperty("ArgumentsSchema");
      expect(tool).toHaveProperty("validate");
      expect(tool).toHaveProperty("run");

      // Validate should return null (no validation needed in plan mode)
      const validateResult = await tool!.validate(
        signal,
        transport,
        {
          name: "prepend",
          arguments: {
            filePath: "/test/file.txt",
            text: "prepended text",
          },
        },
        config,
      );
      expect(validateResult).toBeNull();
    });
  });

  describe("rewrite tool", () => {
    it("returns plan mode message when planFilePath is provided", async () => {
      const tool = await rewrite(signal, transport, config, "/plans/test.md");
      const result = await tool!.run(
        signal,
        transport,
        {
          name: "rewrite",
          arguments: {
            filePath: "/test/file.txt",
            text: "rewritten content",
          },
        },
        config,
        null,
      );

      expect(result).toEqual(createPlanModeToolResult());
      expect(result.content).toBe(PLAN_MODE_MESSAGE);
    });

    it("returns plan mode message with correct tool schema when planFilePath is provided", async () => {
      const tool = await rewrite(signal, transport, config, "/plans/test.md");
      expect(tool).toHaveProperty("Schema");
      expect(tool).toHaveProperty("ArgumentsSchema");
      expect(tool).toHaveProperty("validate");
      expect(tool).toHaveProperty("run");

      // Validate should return null (no validation needed in plan mode)
      const validateResult = await tool!.validate(
        signal,
        transport,
        {
          name: "rewrite",
          arguments: {
            filePath: "/test/file.txt",
            text: "rewritten content",
          },
        },
        config,
      );
      expect(validateResult).toBeNull();
    });
  });

  describe("bash tool", () => {
    it("returns plan mode message when planFilePath is provided", async () => {
      const tool = await bash(signal, transport, config, "/plans/test.md");
      const result = await tool!.run(
        signal,
        transport,
        {
          name: "shell",
          arguments: {
            cmd: "echo hello",
            timeout: 5000,
          },
        },
        config,
        null,
      );

      expect(result).toEqual(createPlanModeToolResult());
      expect(result.content).toBe(PLAN_MODE_MESSAGE);
    });

    it("returns plan mode message with correct tool schema when planFilePath is provided", async () => {
      const tool = await bash(signal, transport, config, "/plans/test.md");
      expect(tool).toHaveProperty("Schema");
      expect(tool).toHaveProperty("ArgumentsSchema");
      expect(tool).toHaveProperty("validate");
      expect(tool).toHaveProperty("run");

      // Validate should return null (no validation needed in plan mode)
      const validateResult = await tool!.validate(
        signal,
        transport,
        {
          name: "shell",
          arguments: {
            cmd: "echo hello",
            timeout: 5000,
          },
        },
        config,
      );
      expect(validateResult).toBeNull();
    });
  });

  describe("all write tools in plan mode", () => {
    it("all tools return the same plan mode message", async () => {
      const expectedResult = createPlanModeToolResult();

      // Test edit tool
      const editTool = await edit(signal, transport, config, "/plans/test.md");
      const editResult = await editTool!.run(
        signal,
        transport,
        {
          name: "edit" as const,
          arguments: { filePath: "/test/file.txt", search: "old", replace: "new" },
        },
        config,
        null,
      );
      expect(editResult).toEqual(expectedResult);

      // Test create tool
      const createTool = await create(signal, transport, config, "/plans/test.md");
      const createResult = await createTool!.run(
        signal,
        transport,
        {
          name: "create" as const,
          arguments: { filePath: "/test/file.txt", content: "content" },
        },
        config,
        null,
      );
      expect(createResult).toEqual(expectedResult);

      // Test append tool
      const appendTool = await append(signal, transport, config, "/plans/test.md");
      const appendResult = await appendTool!.run(
        signal,
        transport,
        {
          name: "append" as const,
          arguments: { filePath: "/test/file.txt", text: "text" },
        },
        config,
        null,
      );
      expect(appendResult).toEqual(expectedResult);

      // Test prepend tool
      const prependTool = await prepend(signal, transport, config, "/plans/test.md");
      const prependResult = await prependTool!.run(
        signal,
        transport,
        {
          name: "prepend" as const,
          arguments: { filePath: "/test/file.txt", text: "text" },
        },
        config,
        null,
      );
      expect(prependResult).toEqual(expectedResult);

      // Test rewrite tool
      const rewriteTool = await rewrite(signal, transport, config, "/plans/test.md");
      const rewriteResult = await rewriteTool!.run(
        signal,
        transport,
        {
          name: "rewrite" as const,
          arguments: { filePath: "/test/file.txt", text: "text" },
        },
        config,
        null,
      );
      expect(rewriteResult).toEqual(expectedResult);

      // Test bash tool
      const bashTool = await bash(signal, transport, config, "/plans/test.md");
      const bashResult = await bashTool!.run(
        signal,
        transport,
        {
          name: "shell" as const,
          arguments: { cmd: "echo hello", timeout: 5000 },
        },
        config,
        null,
      );
      expect(bashResult).toEqual(expectedResult);
    });
  });
});
