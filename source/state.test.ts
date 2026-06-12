import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "./libocto/result.ts";
import type { Config } from "./config.ts";
import type { ToolCall } from "./tools/index.ts";
import type { Transport } from "./transports/transport-common.ts";

const toolMocks = vi.hoisted(() => ({
  loadTools: vi.fn(),
  runTool: vi.fn(),
}));

vi.mock("./config.ts", () => ({
  assertKeyForModel: vi.fn(),
  getModelFromConfig: vi.fn(),
  runNotifyCommand: vi.fn(),
  useConfig: vi.fn(),
}));

vi.mock("./tools/index.ts", async importOriginal => {
  const original = await importOriginal<typeof import("./tools/index.ts")>();
  return {
    ...original,
    loadTools: toolMocks.loadTools,
    runTool: toolMocks.runTool,
  };
});

import { useAppStore } from "./state.ts";

describe("runTool", () => {
  beforeEach(() => {
    toolMocks.loadTools.mockReset();
    toolMocks.runTool.mockReset();
    useAppStore.setState({
      history: [],
      historyVersion: 0,
      conversationAction: null,
      modeData: { mode: "input", vimMode: "INSERT" },
      preMenuModeData: null,
    });
  });

  it("does not append a tool result after the conversation is cleared", async () => {
    let resolveTool!: (result: ReturnType<typeof ok>) => void;
    const toolStarted = new Promise<void>(resolve => {
      toolMocks.runTool.mockImplementation(
        () =>
          new Promise(resultResolve => {
            resolveTool = resultResolve;
            resolve();
          }),
      );
    });
    toolMocks.loadTools.mockResolvedValue({});

    const abortController = new AbortController();
    const toolReq = {
      type: "tool-call",
      name: "read",
      toolCallId: "tool-1",
      original: {},
      parsed: {},
    } as unknown as ToolCall;
    useAppStore.setState({
      history: [
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "",
            toolCalls: [toolReq],
            usage: {
              input: { cached: 0, uncached: 0, total: 0 },
              output: 0,
            },
          },
        },
      ],
      modeData: {
        mode: "tool-call",
        toolReqs: [toolReq],
        runningToolCallId: null,
        abortController,
      },
    });

    const pendingTool = useAppStore.getState().runTool({
      config: {} as Config,
      transport: {} as Transport,
      toolReq,
    });
    await toolStarted;

    useAppStore.getState().clearHistory();
    resolveTool(ok({ type: "content", content: "stale output" }));
    await pendingTool;

    expect(useAppStore.getState().history).toEqual([]);
  });
});
