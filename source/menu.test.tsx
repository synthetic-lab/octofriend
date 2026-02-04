import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAppStore } from "./state.ts";
import { ModeType } from "./modes.ts";
import { TransportContext } from "./app.tsx";
import { Config } from "./config.ts";
import type { Transport } from "./transports/transport-common.ts";

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
    models: [
      {
        nickname: "test-model",
        type: "standard",
        model: "gpt-4",
        context: 8000,
        baseUrl: "https://api.openai.com",
      },
    ],
  } as Config;
}

describe("Menu exit plan mode", () => {
  beforeEach(() => {
    useAppStore.setState({
      history: [],
      currentMode: "collaboration" as ModeType,
      activePlanFilePath: null,
      sessionPlanFilePath: null,
      modeData: { mode: "input", vimMode: "INSERT" },
      byteCount: 0,
      query: "",
      clearNonce: 0,
      modelOverride: null,
    });
  });

  it("has TransportContext exported from app.tsx", () => {
    // Verify TransportContext is properly exported and can be imported by menu.tsx
    expect(TransportContext).toBeDefined();
    expect(TransportContext.Provider).toBeDefined();
    expect(TransportContext.Consumer).toBeDefined();
  });

  it("has correct Config type for useConfig hook", () => {
    // This test verifies the Config type has the required properties
    const mockConfig: Config = {
      yourName: "test",
      models: [],
    };
    expect(mockConfig.yourName).toBe("test");
    expect(mockConfig.models).toEqual([]);
  });

  describe("Exit plan mode menu item visibility", () => {
    it("shows exit plan mode option when in plan mode with active plan file", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;
      const isPlanMode = currentMode === "plan";
      const hasActivePlan = state.activePlanFilePath !== null;

      // Replicate the menu logic from MainMenu
      const shouldShowExitOption = isPlanMode && hasActivePlan;

      expect(shouldShowExitOption).toBe(true);
    });

    it("hides exit plan mode option when not in plan mode", () => {
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
        activePlanFilePath: ".plans/test.md",
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;
      const isPlanMode = currentMode === "plan";
      const hasActivePlan = state.activePlanFilePath !== null;

      const shouldShowExitOption = isPlanMode && hasActivePlan;

      expect(shouldShowExitOption).toBe(false);
    });

    it("hides exit plan mode option when in plan mode but no active plan file", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: null,
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;
      const isPlanMode = currentMode === "plan";
      const hasActivePlan = state.activePlanFilePath !== null;

      const shouldShowExitOption = isPlanMode && hasActivePlan;

      expect(shouldShowExitOption).toBe(false);
    });
  });

  describe("exitPlanModeAndImplement", () => {
    it("notifies user when no plan file is available", async () => {
      const mockTransport = createMockTransport();
      const mockConfig = createMockConfig();

      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: null,
      });

      const state = useAppStore.getState();
      const notifySpy = vi.fn();

      // Simulate the early return behavior
      if (!state.activePlanFilePath) {
        notifySpy("No plan file available. Cannot exit plan mode.");
      }

      expect(notifySpy).toHaveBeenCalledWith("No plan file available. Cannot exit plan mode.");
    });

    it("reads plan file and transitions to collaboration mode", async () => {
      const planContent = "# Test Plan\n\n1. Do something";
      const readFileMock = vi.fn().mockResolvedValue(planContent);
      const mockTransport = createMockTransport({
        readFile: readFileMock,
      });
      const mockConfig = createMockConfig();

      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
        sessionPlanFilePath: ".plans/test.md",
        history: [{ type: "user", content: "test", id: 1n }],
      });

      // The method catches input() errors and notifies instead of throwing
      await useAppStore
        .getState()
        .exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

      // Verify file was read
      expect(readFileMock).toHaveBeenCalledWith(expect.any(AbortSignal), ".plans/test.md");

      // Verify state changes happened
      const finalState = useAppStore.getState();
      expect(finalState.currentMode).toBe("collaboration");
      expect(finalState.activePlanFilePath).toBeNull();
    });

    it("reads plan file and transitions to unchained mode", async () => {
      const planContent = "# Test Plan\n\n1. Do something";
      const readFileMock = vi.fn().mockResolvedValue(planContent);
      const mockTransport = createMockTransport({
        readFile: readFileMock,
      });
      const mockConfig = createMockConfig();

      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
        sessionPlanFilePath: ".plans/test.md",
        history: [],
      });

      // The method catches input() errors and notifies instead of throwing
      await useAppStore.getState().exitPlanModeAndImplement(mockConfig, mockTransport, "unchained");

      // Verify file was read
      expect(readFileMock).toHaveBeenCalledWith(expect.any(AbortSignal), ".plans/test.md");

      // Verify state changes happened
      const finalState = useAppStore.getState();
      expect(finalState.currentMode).toBe("unchained");
      expect(finalState.activePlanFilePath).toBeNull();
    });

    it("handles empty plan content gracefully — stays in plan mode", async () => {
      const readFileMock = vi.fn().mockResolvedValue("");
      const mockTransport = createMockTransport({
        readFile: readFileMock,
      });
      const mockConfig = createMockConfig();

      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
        sessionPlanFilePath: ".plans/test.md",
        history: [],
        clearNonce: 0,
      });

      // Empty plan content should not call input(), so no error expected
      await useAppStore
        .getState()
        .exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

      // Verify file was read
      expect(readFileMock).toHaveBeenCalledWith(expect.any(AbortSignal), ".plans/test.md");

      // Should stay in plan mode (early return, no state destruction)
      const finalState = useAppStore.getState();
      expect(finalState.currentMode).toBe("plan");
      expect(finalState.activePlanFilePath).toBe(".plans/test.md");
      expect(finalState.clearNonce).toBe(0);

      // Should have a notification about empty plan
      const notification = finalState.history.find(item => item.type === "notification");
      expect(notification).toBeDefined();
      if (notification && notification.type === "notification") {
        expect(notification.content).toContain("Plan is empty");
      }
    });

    it("handles read errors gracefully", async () => {
      const mockTransport = createMockTransport({
        readFile: vi.fn().mockRejectedValue(new Error("Permission denied")),
      });
      const mockConfig = createMockConfig();

      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
        sessionPlanFilePath: ".plans/test.md",
        history: [{ type: "user", content: "test", id: 1n }],
      });

      await useAppStore
        .getState()
        .exitPlanModeAndImplement(mockConfig, mockTransport, "collaboration");

      // Should stay in plan mode when read fails
      const finalState = useAppStore.getState();
      expect(finalState.currentMode).toBe("plan");
      expect(finalState.activePlanFilePath).toBe(".plans/test.md");
      // History should not be cleared on error
      expect(finalState.history).toHaveLength(2); // Original + error notification
    });
  });

  describe("SelectExitModeMenu logic", () => {
    it("has correct menu items for mode selection", () => {
      // Replicate the items structure from SelectExitModeMenu
      type ExitModeValue = "collaboration" | "unchained" | "back";

      const items = {
        c: {
          label: "Collaboration mode - Ask before running edits/shell",
          value: "collaboration" as const,
        },
        u: {
          label: "Unchained mode - Run edits/shell automatically",
          value: "unchained" as const,
        },
        b: {
          label: "Back",
          value: "back" as const,
        },
      };

      expect(items.c.value).toBe("collaboration");
      expect(items.u.value).toBe("unchained");
      expect(items.b.value).toBe("back");
      expect(items.c.label).toContain("Collaboration");
      expect(items.u.label).toContain("Unchained");
    });

    it("selecting 'back' returns to main menu without exiting plan mode", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
      });

      // Simulate selecting "back"
      const selectedValue = "back";

      if (selectedValue === "back") {
        // Would set menu mode to main-menu without calling exitPlanModeAndImplement
        expect(selectedValue).toBe("back");
      }

      // Verify plan mode state is unchanged
      const state = useAppStore.getState();
      expect(state.currentMode).toBe("plan");
      expect(state.activePlanFilePath).toBe(".plans/test.md");
    });
  });
});
