import { describe, it, expect, vi, beforeEach } from "vitest";
import { trajectoryArc } from "./trajectory-arc.ts";
import type { Transport } from "../transports/transport-common.ts";

import { run } from "../compilers/run.ts";
import { shouldAutoCompactHistory } from "../compilers/autocompact.ts";
import { loadTools, PLAN_MODE_TOOLS } from "../tools/index.ts";

vi.mock("../compilers/run.ts", () => ({
  run: vi.fn(),
}));

vi.mock("../compilers/autocompact.ts", () => ({
  shouldAutoCompactHistory: vi.fn(),
  generateCompactionSummary: vi.fn(),
}));

vi.mock("../prompts/system-prompt.ts", () => ({
  systemPrompt: vi.fn().mockResolvedValue("system prompt"),
}));

vi.mock("../tools/index.ts", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    loadTools: vi.fn(),
    validateTool: vi.fn().mockResolvedValue(undefined),
  };
});

function createMockTransport(): Transport {
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
  };
}

describe("trajectoryArc plan mode", () => {
  const mockConfig = { yourName: "test", models: [] } as any;
  const mockModel = { nickname: "test-model", baseUrl: "http://test", model: "test" } as any;
  let mockTransport: Transport;

  const handler = {
    startResponse: vi.fn(),
    responseProgress: vi.fn(),
    startCompaction: vi.fn(),
    compactionProgress: vi.fn(),
    compactionParsed: vi.fn(),
    autofixingJson: vi.fn(),
    autofixingDiff: vi.fn(),
    retryTool: vi.fn(),
  };

  const mockRunResult = {
    success: true,
    output: [
      {
        role: "assistant",
        content: "test response",
        toolCall: null,
        tokenUsage: 10,
        outputTokens: 5,
      },
    ],
    curl: "",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTransport = createMockTransport();
    vi.mocked(run).mockResolvedValue(mockRunResult as any);
    vi.mocked(shouldAutoCompactHistory).mockReturnValue(false);
    vi.mocked(loadTools).mockResolvedValue({} as any);
  });

  it("passes PLAN_MODE_TOOLS for allowedTools when in plan mode", async () => {
    await trajectoryArc({
      apiKey: "test-key",
      model: mockModel,
      messages: [],
      config: mockConfig,
      transport: mockTransport,
      abortSignal: new AbortController().signal,
      planModeConfig: { isPlanMode: true, planFilePath: "/plans/test.md" },
      handler,
    });

    expect(loadTools).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      PLAN_MODE_TOOLS,
      "/plans/test.md",
    );
  });

  it("passes null planFilePath when isPlanMode is false", async () => {
    await trajectoryArc({
      apiKey: "test-key",
      model: mockModel,
      messages: [],
      config: mockConfig,
      transport: mockTransport,
      abortSignal: new AbortController().signal,
      planModeConfig: { isPlanMode: false },
      handler,
    });

    expect(loadTools).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      undefined,
      null,
    );
  });

  it("passes correct allowedTools and planFilePath based on isPlanMode", async () => {
    // When isPlanMode is true, allowedTools should be PLAN_MODE_TOOLS and planFilePath should be set
    await trajectoryArc({
      apiKey: "test-key",
      model: mockModel,
      messages: [],
      config: mockConfig,
      transport: mockTransport,
      abortSignal: new AbortController().signal,
      planModeConfig: { isPlanMode: true, planFilePath: "/plans/test.md" },
      handler,
    });

    expect(loadTools).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      PLAN_MODE_TOOLS,
      "/plans/test.md",
    );

    vi.clearAllMocks();

    // When isPlanMode is false, allowedTools should be undefined and planFilePath should be null
    await trajectoryArc({
      apiKey: "test-key",
      model: mockModel,
      messages: [],
      config: mockConfig,
      transport: mockTransport,
      abortSignal: new AbortController().signal,
      planModeConfig: { isPlanMode: false },
      handler,
    });

    expect(loadTools).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      undefined,
      null,
    );
  });
});
