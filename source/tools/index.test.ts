import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadTools,
  SKIP_CONFIRMATION,
  READONLY_TOOLS,
  PLAN_MODE_TOOLS,
  runTool,
  validateTool,
} from "./index.ts";
import { ToolError } from "./common.ts";
import { Config } from "../config.ts";
import { Transport } from "../transports/transport-common.ts";

describe("loadTools", () => {
  let mockTransport: Transport;
  let mockConfig: Config;
  const signal = new AbortController().signal;

  beforeEach(() => {
    mockTransport = {
      cwd: vi.fn().mockResolvedValue("/test"),
      close: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(""),
      modTime: vi.fn().mockResolvedValue(Date.now()),
      resolvePath: vi.fn().mockResolvedValue("/test/path"),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      pathExists: vi.fn().mockResolvedValue(true),
      isDirectory: vi.fn().mockResolvedValue(false),
      shell: vi.fn().mockResolvedValue(""),
    } as unknown as Transport;

    mockConfig = {
      yourName: "test",
      models: [],
    } as Config;
  });

  it("loads all tools when allowedTools is undefined", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, undefined, null);

    // Should load all available tools
    expect(Object.keys(loaded).length).toBeGreaterThan(0);
    expect(loaded.read).toBeDefined();
    expect(loaded.list).toBeDefined();
    expect(loaded.fetch).toBeDefined();
  });

  it("loads only specified tools when allowedTools is provided", async () => {
    const allowedTools: Array<"read" | "list" | "fetch"> = ["read", "list", "fetch"];
    const loaded = await loadTools(mockTransport, signal, mockConfig, allowedTools, null);

    // Should only load the specified tools
    expect(loaded.read).toBeDefined();
    expect(loaded.list).toBeDefined();
    expect(loaded.fetch).toBeDefined();

    // Other tools should not be loaded
    expect(loaded.edit).toBeUndefined();
    expect(loaded.create).toBeUndefined();
    expect(loaded.append).toBeUndefined();
  });

  it("loads empty object when allowedTools is empty array", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, [], null);

    expect(Object.keys(loaded).length).toBe(0);
  });

  it("loads only read tools when READONLY_TOOLS is used", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, READONLY_TOOLS, null);

    // Core read-only tools should always be loaded
    expect(loaded.read).toBeDefined();
    expect(loaded.list).toBeDefined();
    expect(loaded.fetch).toBeDefined();
    expect(loaded["web-search"]).toBeDefined();

    // write-plan is NOT in READONLY_TOOLS
    expect(loaded["write-plan"]).toBeUndefined();

    // Write/modify tools should NOT be loaded
    expect(loaded.edit).toBeUndefined();
    expect(loaded.create).toBeUndefined();
    expect(loaded.append).toBeUndefined();
    expect(loaded.prepend).toBeUndefined();
    expect(loaded.rewrite).toBeUndefined();
  });

  it("loads read-only tools plus write-plan when PLAN_MODE_TOOLS is used", async () => {
    const loaded = await loadTools(
      mockTransport,
      signal,
      mockConfig,
      PLAN_MODE_TOOLS,
      "/test/plan.md",
    );

    // All read-only tools should be loaded
    expect(loaded.read).toBeDefined();
    expect(loaded.list).toBeDefined();
    expect(loaded.fetch).toBeDefined();
    expect(loaded["web-search"]).toBeDefined();
    expect(loaded["write-plan"]).toBeDefined();

    // Write/modify tools should NOT be loaded
    expect(loaded.edit).toBeUndefined();
    expect(loaded.create).toBeUndefined();
    expect(loaded.append).toBeUndefined();
    expect(loaded.prepend).toBeUndefined();
    expect(loaded.rewrite).toBeUndefined();
  });

  it("passes planFilePath to tool factories when provided", async () => {
    const planFilePath = "/test/plan.md";
    const loaded = await loadTools(mockTransport, signal, mockConfig, undefined, planFilePath);

    // Tools should be loaded (factories receive the planFilePath parameter)
    expect(Object.keys(loaded).length).toBeGreaterThan(0);
  });

  it("handles individual tool loading failures gracefully", async () => {
    // Create a scenario where one tool fails to load
    // The skill tool calls transport.cwd during initialization
    const failingTransport = {
      ...mockTransport,
      cwd: vi.fn().mockRejectedValue(new Error("Tool loading failed")),
    };

    // Load tools - despite the skill tool failing, other tools should still load
    const loaded = await loadTools(failingTransport, signal, mockConfig, undefined, null);

    // Should still have other tools loaded even if one tool failed
    expect(Object.keys(loaded).length).toBeGreaterThan(0);

    // Basic tools should still be available
    expect(loaded.read).toBeDefined();
    expect(loaded.list).toBeDefined();
    expect(loaded.fetch).toBeDefined();

    // The skill tool likely failed to load due to the error
    expect(loaded.skill).toBeUndefined();
  });

  it("continues loading other tools when one tool fails", async () => {
    // Test that a single tool failure doesn't prevent other tools from loading
    const failingTransport = {
      ...mockTransport,
      shell: vi.fn().mockRejectedValue(new Error("Shell command failed during tool loading")),
    };

    const loaded = await loadTools(failingTransport, signal, mockConfig, undefined, null);

    // Verify that some tools still loaded despite the error
    // Shell tool likely won't load due to the error
    expect(Object.keys(loaded).length).toBeGreaterThan(0);

    // Read and list tools use other transport methods, should still load
    expect(loaded.read).toBeDefined();
    expect(loaded.list).toBeDefined();
  });
});

describe("SKIP_CONFIRMATION", () => {
  it("contains expected tool names", () => {
    expect(SKIP_CONFIRMATION).toContain("read");
    expect(SKIP_CONFIRMATION).toContain("list");
    expect(SKIP_CONFIRMATION).toContain("fetch");
    expect(SKIP_CONFIRMATION).toContain("skill");
    expect(SKIP_CONFIRMATION).toContain("web-search");
    expect(SKIP_CONFIRMATION).toContain("write-plan");
  });

  it("does not contain write/modify tools", () => {
    expect(SKIP_CONFIRMATION).not.toContain("edit");
    expect(SKIP_CONFIRMATION).not.toContain("create");
    expect(SKIP_CONFIRMATION).not.toContain("append");
    expect(SKIP_CONFIRMATION).not.toContain("prepend");
    expect(SKIP_CONFIRMATION).not.toContain("rewrite");
    expect(SKIP_CONFIRMATION).not.toContain("shell");
  });
});

describe("READONLY_TOOLS", () => {
  it("contains expected read-only tool names", () => {
    expect(READONLY_TOOLS).toContain("read");
    expect(READONLY_TOOLS).toContain("list");
    expect(READONLY_TOOLS).toContain("fetch");
    expect(READONLY_TOOLS).toContain("skill");
    expect(READONLY_TOOLS).toContain("web-search");
  });

  it("does not contain write-plan", () => {
    expect(READONLY_TOOLS).not.toContain("write-plan");
  });

  it("does not contain write/modify tools", () => {
    expect(READONLY_TOOLS).not.toContain("edit");
    expect(READONLY_TOOLS).not.toContain("create");
    expect(READONLY_TOOLS).not.toContain("append");
    expect(READONLY_TOOLS).not.toContain("prepend");
    expect(READONLY_TOOLS).not.toContain("rewrite");
    expect(READONLY_TOOLS).not.toContain("shell");
  });
});

describe("PLAN_MODE_TOOLS", () => {
  it("contains all READONLY_TOOLS plus write-plan", () => {
    for (const tool of READONLY_TOOLS) {
      expect(PLAN_MODE_TOOLS).toContain(tool);
    }
    expect(PLAN_MODE_TOOLS).toContain("write-plan");
  });

  it("does not contain write/modify tools", () => {
    expect(PLAN_MODE_TOOLS).not.toContain("edit");
    expect(PLAN_MODE_TOOLS).not.toContain("create");
    expect(PLAN_MODE_TOOLS).not.toContain("append");
    expect(PLAN_MODE_TOOLS).not.toContain("prepend");
    expect(PLAN_MODE_TOOLS).not.toContain("rewrite");
    expect(PLAN_MODE_TOOLS).not.toContain("shell");
  });
});

describe("runTool", () => {
  let mockTransport: Transport;
  let mockConfig: Config;
  const signal = new AbortController().signal;

  beforeEach(() => {
    mockTransport = {
      cwd: vi.fn().mockResolvedValue("/test"),
      close: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue("file content"),
      modTime: vi.fn().mockResolvedValue(Date.now()),
      resolvePath: vi.fn().mockResolvedValue("/test/path"),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      pathExists: vi.fn().mockResolvedValue(true),
      isDirectory: vi.fn().mockResolvedValue(false),
      shell: vi.fn().mockResolvedValue(""),
    } as unknown as Transport;

    mockConfig = {
      yourName: "test",
      models: [],
    } as Config;
  });

  it("executes a loaded tool successfully", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, ["read"], null);

    const toolCall = {
      name: "read" as const,
      arguments: {
        filePath: "/test/file.txt",
      },
    };

    const result = await runTool(signal, mockTransport, loaded, toolCall, mockConfig, null);

    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  });

  it("throws ToolError when tool is not loaded", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, ["read"], null);

    const toolCall = {
      name: "edit" as const,
      arguments: {
        filePath: "/test/file.txt",
        search: "old",
        replace: "new",
      },
    };

    await expect(
      runTool(signal, mockTransport, loaded, toolCall, mockConfig, null),
    ).rejects.toThrow(ToolError);
  });

  it("throws ToolError with correct message for missing tool", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, ["read"], null);

    const toolCall = {
      name: "create" as const,
      arguments: {
        filePath: "/test/file.txt",
        content: "test",
      },
    };

    await expect(
      runTool(signal, mockTransport, loaded, toolCall, mockConfig, null),
    ).rejects.toThrow("No tool named create");
  });
});

describe("validateTool", () => {
  let mockTransport: Transport;
  let mockConfig: Config;
  const signal = new AbortController().signal;

  beforeEach(() => {
    mockTransport = {
      cwd: vi.fn().mockResolvedValue("/test"),
      close: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue("file content"),
      modTime: vi.fn().mockResolvedValue(Date.now()),
      resolvePath: vi.fn().mockResolvedValue("/test/path"),
      mkdir: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue([]),
      pathExists: vi.fn().mockResolvedValue(true),
      isDirectory: vi.fn().mockResolvedValue(false),
      shell: vi.fn().mockResolvedValue(""),
    } as unknown as Transport;

    mockConfig = {
      yourName: "test",
      models: [],
    } as Config;
  });

  it("validates a loaded tool successfully", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, ["read"], null);

    const toolCall = {
      name: "read" as const,
      arguments: {
        filePath: "/test/file.txt",
      },
    };

    // Should not throw
    await expect(
      validateTool(signal, mockTransport, loaded, toolCall, mockConfig),
    ).resolves.toBeNull();
  });

  it("throws ToolError when validating unloaded tool", async () => {
    const loaded = await loadTools(mockTransport, signal, mockConfig, ["read"], null);

    const toolCall = {
      name: "edit" as const,
      arguments: {
        filePath: "/test/file.txt",
        search: "old",
        replace: "new",
      },
    };

    await expect(validateTool(signal, mockTransport, loaded, toolCall, mockConfig)).rejects.toThrow(
      ToolError,
    );
  });
});
