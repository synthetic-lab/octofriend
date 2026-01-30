import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAppStore } from "./state.ts";
import { MODES } from "./modes.ts";
import { Config } from "./config.ts";
import { Transport } from "./transports/transport-common.ts";
import { sequenceId, HistoryItem } from "./history.ts";
import { ToolCallRequest } from "./ir/llm-ir.ts";
import { ToolResult, ToolError } from "./tools/common.ts";
import * as toolsModule from "./tools/index.ts";

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

describe("runTool", () => {
  let mockTransport: Transport;
  let mockConfig: Config;

  beforeEach(() => {
    // Reset the store state before each test
    useAppStore.setState({
      history: [],
      modeIndex: 0,
      activePlanFilePath: null,
      modeData: { mode: "input", vimMode: "INSERT" },
      byteCount: 0,
      query: "",
      clearNonce: 0,
      modelOverride: null,
    });

    mockTransport = createMockTransport();
    mockConfig = createMockConfig();

    // Mock loadTools to return empty tools object
    vi.spyOn(toolsModule, "loadTools").mockResolvedValue({});

    // Mock runTool to return a successful result
    vi.spyOn(toolsModule, "runTool").mockResolvedValue({
      content: "test result",
    } as ToolResult);

    // Mock _runAgent to prevent actual agent execution
    vi.spyOn(useAppStore.getState(), "_runAgent").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createToolRequest(
    name:
      | "read"
      | "write-plan"
      | "list"
      | "shell"
      | "edit"
      | "create"
      | "mcp"
      | "fetch"
      | "prepend"
      | "rewrite"
      | "skill"
      | "web-search",
    args: Record<string, unknown>,
    toolCallId = "call-1",
  ): ToolCallRequest {
    return {
      type: "function",
      toolCallId,
      function: {
        name,
        arguments: args,
      },
    } as ToolCallRequest;
  }

  it("passes planFilePath to loadTools when in plan mode", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"),
      activePlanFilePath: "/plans/test.md",
    });

    const loadToolsMock = vi.spyOn(toolsModule, "loadTools").mockResolvedValue({});

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" });

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    expect(loadToolsMock).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      toolsModule.PLAN_MODE_TOOLS,
      "/plans/test.md",
    );
  });

  it("passes null planFilePath to loadTools when not in plan mode", async () => {
    useAppStore.setState({
      modeIndex: 0, // collaboration mode
      activePlanFilePath: "/plans/test.md", // set but should not be passed
    });

    const loadToolsMock = vi.spyOn(toolsModule, "loadTools").mockResolvedValue({});

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" });

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    expect(loadToolsMock).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      undefined,
      null,
    );
  });

  it("passes null planFilePath when planFilePath is null in plan mode", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"), // plan mode
      activePlanFilePath: null,
    });

    const loadToolsMock = vi.spyOn(toolsModule, "loadTools").mockResolvedValue({});

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" });

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    expect(loadToolsMock).toHaveBeenCalledWith(
      mockTransport,
      expect.any(AbortSignal),
      mockConfig,
      toolsModule.PLAN_MODE_TOOLS,
      null,
    );
  });

  it("creates plan-written history item when write-plan tool succeeds", async () => {
    const planContent = "# Test Plan\n\nImplementation steps";

    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"), // plan mode
      activePlanFilePath: "/plans/test.md",
    });

    vi.spyOn(toolsModule, "runTool").mockResolvedValue({
      content: planContent,
      lines: 3,
    } as ToolResult);

    const toolReq = createToolRequest("write-plan", { content: planContent });

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    const history = useAppStore.getState().history;
    const planWrittenItem = history.find((item: HistoryItem) => item.type === "plan-written");

    expect(planWrittenItem).toBeDefined();
    expect(planWrittenItem).toMatchObject({
      type: "plan-written",
      planFilePath: "/plans/test.md",
      content: planContent,
    });
  });

  it("creates tool-output history item for non-write-plan tools", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"), // plan mode
      activePlanFilePath: "/plans/test.md",
    });

    const toolResult: ToolResult = {
      content: "file contents here",
      lines: 10,
    };
    vi.spyOn(toolsModule, "runTool").mockResolvedValue(toolResult);

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" }, "call-2");

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    const history = useAppStore.getState().history;
    const toolOutputItem = history.find((item: HistoryItem) => item.type === "tool-output");

    expect(toolOutputItem).toBeDefined();
    expect(toolOutputItem).toMatchObject({
      type: "tool-output",
      result: toolResult,
      toolCallId: "call-2",
    });

    // Should NOT have a plan-written item
    const planWrittenItem = history.find((item: HistoryItem) => item.type === "plan-written");
    expect(planWrittenItem).toBeUndefined();
  });

  it("creates tool-failed history item when tool throws ToolError in plan mode", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"), // plan mode
      activePlanFilePath: "/plans/test.md",
    });

    vi.spyOn(toolsModule, "runTool").mockRejectedValue(new ToolError("Tool execution failed"));

    const toolReq = createToolRequest("write-plan", { content: "test" }, "call-3");

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    const history = useAppStore.getState().history;
    const toolFailedItem = history.find((item: HistoryItem) => item.type === "tool-failed");

    expect(toolFailedItem).toBeDefined();
    expect(toolFailedItem).toMatchObject({
      type: "tool-failed",
      error: "Tool execution failed",
      toolCallId: "call-3",
      toolName: "write-plan",
    });
  });

  it("sets modeData to tool-waiting during tool execution", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"),
      activePlanFilePath: "/plans/test.md",
    });

    // Create a promise that we can resolve manually to control timing
    let resolveRunTool: (value: ToolResult) => void;
    const runToolPromise = new Promise<ToolResult>(resolve => {
      resolveRunTool = resolve;
    });
    vi.spyOn(toolsModule, "runTool").mockReturnValue(runToolPromise);

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" });

    const store = useAppStore.getState();
    const runToolPromise2 = store.runTool({
      config: mockConfig,
      transport: mockTransport,
      toolReq,
    });

    // Check state immediately (before await)
    expect(useAppStore.getState().modeData).toMatchObject({
      mode: "tool-waiting",
    });
    expect(useAppStore.getState().modeData).toHaveProperty("abortController");

    // Resolve the tool execution
    resolveRunTool!({ content: "done" });
    await runToolPromise2;
  });

  it("calls _runAgent after tool completion", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"),
      activePlanFilePath: "/plans/test.md",
    });

    const runAgentMock = vi.spyOn(useAppStore.getState(), "_runAgent").mockResolvedValue(undefined);

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" });

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    expect(runAgentMock).toHaveBeenCalledWith({
      config: mockConfig,
      transport: mockTransport,
    });
  });

  it("does not call _runAgent when aborted", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"),
      activePlanFilePath: "/plans/test.md",
    });

    const runAgentMock = vi.spyOn(useAppStore.getState(), "_runAgent").mockResolvedValue(undefined);

    // Create a promise that rejects when aborted
    vi.spyOn(toolsModule, "runTool").mockImplementation(() => {
      return new Promise((_, reject) => {
        // This will be rejected by the abort controller
        setTimeout(() => reject(new Error("Aborted")), 100);
      });
    });

    const toolReq = createToolRequest("read", { filePath: "/test/file.txt" });

    const store = useAppStore.getState();
    const runToolPromise = store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    // Small delay to let runTool start
    await new Promise(resolve => setTimeout(resolve, 10));

    // Abort the operation
    const abortController = (
      useAppStore.getState().modeData as { abortController: AbortController }
    ).abortController;
    abortController.abort();

    // Wait for the promise to settle (it may throw, which is fine)
    try {
      await runToolPromise;
    } catch {
      // Expected - the abort may cause errors
    }

    // _runAgent should not be called after abort
    expect(runAgentMock).not.toHaveBeenCalled();
  }, 5000);

  it("handles write-plan tool result without content property", async () => {
    useAppStore.setState({
      modeIndex: MODES.indexOf("plan"),
      activePlanFilePath: "/plans/test.md",
    });

    // Return a result without content property (edge case)
    vi.spyOn(toolsModule, "runTool").mockResolvedValue({
      someOtherProperty: "value",
    } as unknown as ToolResult);

    const toolReq = createToolRequest("write-plan", { content: "test" });

    const store = useAppStore.getState();
    await store.runTool({ config: mockConfig, transport: mockTransport, toolReq });

    const history = useAppStore.getState().history;
    const planWrittenItem = history.find((item: HistoryItem) => item.type === "plan-written");

    expect(planWrittenItem).toBeDefined();
    // Should convert non-content result to string
    expect(planWrittenItem).toHaveProperty("content");
  });
});

describe("exitPlanModeAndImplement", () => {
  let mockTransport: Transport;
  let mockConfig: Config;

  beforeEach(() => {
    // Reset the store state before each test
    useAppStore.setState({
      history: [],
      modeIndex: MODES.indexOf("plan"),
      activePlanFilePath: null,
      modeData: { mode: "input", vimMode: "INSERT" },
      byteCount: 0,
      query: "",
      clearNonce: 0,
      modelOverride: null,
    });

    // Create mock transport
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

    // Create minimal mock config
    mockConfig = {
      yourName: "test",
      models: [],
    } as Config;
  });

  it("reads plan file and triggers implementation", async () => {
    const planContent = "# Implementation Plan\n\n## Goal\nBuild a feature";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    // Set up store with plan file path
    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
    });

    const store = useAppStore.getState();
    const inputSpy = vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    expect(mockTransport.readFile).toHaveBeenCalledWith(expect.any(AbortSignal), "/plans/test.md");
    expect(inputSpy).toHaveBeenCalledWith({
      config: mockConfig,
      transport: mockTransport,
      query: `Please implement the following plan:\n\n${planContent}`,
    });
  });

  it("clears history before implementation", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      history: [{ type: "user" as const, id: sequenceId(), content: "previous message" }],
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    // clearNonce should be incremented, indicating history was cleared
    expect(useAppStore.getState().clearNonce).toBe(1);
  });

  it("sets isPlanMode to false and modeIndex to 0", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      modeIndex: MODES.indexOf("plan"), // plan mode
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    const state = useAppStore.getState();
    const currentMode = MODES[state.modeIndex];
    const isPlanMode = currentMode === "plan";
    expect(isPlanMode).toBe(false);
    expect(state.modeIndex).toBe(0); // Should switch to collaboration mode
  });

  it("clears planFilePath on exit", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      modeIndex: MODES.indexOf("plan"),
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    expect(useAppStore.getState().activePlanFilePath).toBeNull();
  });

  it("handles read error gracefully — keeps history and stays in plan mode", async () => {
    mockTransport.readFile = vi.fn().mockRejectedValue(new Error("File not found"));

    const initialClearNonce = useAppStore.getState().clearNonce;

    useAppStore.setState({
      activePlanFilePath: "/plans/missing.md",
      modeIndex: MODES.indexOf("plan"),
    });

    const store = useAppStore.getState();
    const inputSpy = vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    // input should NOT be called
    expect(inputSpy).not.toHaveBeenCalled();

    // History should NOT be cleared (clearNonce unchanged)
    expect(useAppStore.getState().clearNonce).toBe(initialClearNonce);

    // Mode should stay at plan (early return, no mode switch)
    const currentMode = MODES[useAppStore.getState().modeIndex];
    expect(currentMode).toBe("plan");

    // Should notify with the file path included
    const history = useAppStore.getState().history;
    const notification = history.find((item: HistoryItem) => item.type === "notification");
    expect(notification).toBeDefined();
    if (notification && notification.type === "notification") {
      expect(notification.content).toContain("/plans/missing.md");
    }
  });

  it("handles null planFilePath", async () => {
    const initialClearNonce = useAppStore.getState().clearNonce;

    useAppStore.setState({
      activePlanFilePath: null,
    });

    const store = useAppStore.getState();
    const inputSpy = vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    expect(mockTransport.readFile).not.toHaveBeenCalled();
    expect(inputSpy).not.toHaveBeenCalled();

    // Should notify that no plan file is available
    const history = useAppStore.getState().history;
    const notification = history.find((item: HistoryItem) => item.type === "notification");
    expect(notification).toBeDefined();
    if (notification && notification.type === "notification") {
      expect(notification.content).toContain("No plan file available");
    }

    // clearNonce should NOT be incremented (early return, no history clear)
    expect(useAppStore.getState().clearNonce).toBe(initialClearNonce);
  });

  it("returns to input mode after exit", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      modeData: { mode: "menu" },
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    expect(useAppStore.getState().modeData).toEqual({
      mode: "input",
      vimMode: "INSERT",
    });
  });

  it("sets modeIndex to 1 when unchained mode is selected", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      modeIndex: MODES.indexOf("plan"), // plan mode
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "unchained");

    const state = useAppStore.getState();
    const currentMode = MODES[state.modeIndex];
    const isPlanMode = currentMode === "plan";
    expect(isPlanMode).toBe(false);
    expect(state.modeIndex).toBe(1); // Should switch to unchained mode
  });

  it("calls notify with correct message when entering collaboration mode", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);
    const notifySpy = vi.spyOn(store, "notify");

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      "Exited plan mode. Entering Collaboration mode. Beginning implementation from plan.",
    );
  });

  it("calls notify with correct message when entering unchained mode", async () => {
    const planContent = "# Plan";
    mockTransport.readFile = vi.fn().mockResolvedValue(planContent);

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
    });

    const store = useAppStore.getState();
    vi.spyOn(store, "input").mockResolvedValue(undefined);
    const notifySpy = vi.spyOn(store, "notify");

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "unchained");

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(
      "Exited plan mode. Entering Unchained mode. Beginning implementation from plan.",
    );
  });

  it("handles empty plan content — notifies and still switches modes", async () => {
    mockTransport.readFile = vi.fn().mockResolvedValue("");

    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      modeIndex: MODES.indexOf("plan"),
    });

    const store = useAppStore.getState();
    const inputSpy = vi.spyOn(store, "input").mockResolvedValue(undefined);

    await store.exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

    // input should NOT be called (there's no plan content to implement)
    expect(inputSpy).not.toHaveBeenCalled();

    // A notification containing "No plan content found" should appear in history
    const history = useAppStore.getState().history;
    const notification = history.find((item: HistoryItem) => item.type === "notification");
    expect(notification).toBeDefined();
    if (notification && notification.type === "notification") {
      expect(notification.content).toContain("No plan content found");
    }

    // The mode should still switch (clearNonce incremented, no longer in plan mode)
    expect(useAppStore.getState().clearNonce).toBeGreaterThan(0);
    const currentMode = MODES[useAppStore.getState().modeIndex];
    expect(currentMode).not.toBe("plan");
  });

  it("clearHistory resets plan paths", () => {
    useAppStore.setState({
      activePlanFilePath: "/plans/test.md",
      sessionPlanFilePath: "/plans/test.md",
    });

    useAppStore.getState().clearHistory();

    expect(useAppStore.getState().activePlanFilePath).toBeNull();
    expect(useAppStore.getState().sessionPlanFilePath).toBeNull();
  });
});
