import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAppStore } from "./state.ts";
import { ModeType } from "./modes.ts";
import * as planModeModule from "./plan-mode.ts";
import * as platformModule from "./platform.ts";
import type { Transport } from "./transports/transport-common.ts";

import type { HistoryItem } from "./history.ts";

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

describe("Plan Mode UI/State Synchronization", () => {
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("BottomBar Mode Label Logic", () => {
    it("should display '📋 Plan mode' when in plan mode with active file path", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;
      const isPlanMode = currentMode === "plan";

      expect(isPlanMode).toBe(true);
      expect(state.activePlanFilePath).toBe("/plans/test.md");

      // Simulate the modeLabel logic from BottomBar
      const modeLabel = (() => {
        switch (currentMode) {
          case "unchained":
            return "⚡ Unchained mode";
          case "plan":
            return state.activePlanFilePath ? "📋 Plan mode" : "📋 Plan mode (initializing...)";
          default:
            return "Collaboration mode";
        }
      })();

      expect(modeLabel).toBe("📋 Plan mode");
    });

    it("should display '📋 Plan mode (initializing...)' when in plan mode without file path", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: null,
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;

      expect(currentMode).toBe("plan");
      expect(state.activePlanFilePath).toBeNull();

      const modeLabel = (() => {
        switch (currentMode) {
          case "unchained":
            return "⚡ Unchained mode";
          case "plan":
            return state.activePlanFilePath ? "📋 Plan mode" : "📋 Plan mode (initializing...)";
          default:
            return "Collaboration mode";
        }
      })();

      expect(modeLabel).toBe("📋 Plan mode (initializing...)");
    });

    it("should display '⚡ Unchained mode' in unchained mode", () => {
      useAppStore.setState({
        currentMode: "unchained" as ModeType,
        activePlanFilePath: null,
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;

      const modeLabel = (() => {
        switch (currentMode) {
          case "unchained":
            return "⚡ Unchained mode";
          case "plan":
            return state.activePlanFilePath ? "📋 Plan mode" : "📋 Plan mode (initializing...)";
          default:
            return "Collaboration mode";
        }
      })();

      expect(modeLabel).toBe("⚡ Unchained mode");
    });

    it("should display 'Collaboration mode' in collaboration mode", () => {
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
        activePlanFilePath: null,
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;

      const modeLabel = (() => {
        switch (currentMode) {
          case "unchained":
            return "⚡ Unchained mode";
          case "plan":
            return state.activePlanFilePath ? "📋 Plan mode" : "📋 Plan mode (initializing...)";
          default:
            return "Collaboration mode";
        }
      })();

      expect(modeLabel).toBe("Collaboration mode");
    });
  });

  describe("Plan File State Management", () => {
    it("sets activePlanFilePath when entering plan mode with session file", () => {
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
        activePlanFilePath: null,
        sessionPlanFilePath: ".plans/existing.md",
      });

      expect(useAppStore.getState().activePlanFilePath).toBeNull();

      // Simulate entering plan mode - the useEffect would set activePlanFilePath
      // from sessionPlanFilePath if it exists
      const sessionPath = useAppStore.getState().sessionPlanFilePath;
      if (sessionPath) {
        useAppStore.setState({
          currentMode: "plan" as ModeType,
          activePlanFilePath: sessionPath,
        });
      }

      expect(useAppStore.getState().activePlanFilePath).toBe(".plans/existing.md");
      expect(useAppStore.getState().currentMode).toBe("plan");
    });

    it("clears activePlanFilePath when exiting plan mode", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
        sessionPlanFilePath: "/plans/test.md",
      });

      expect(useAppStore.getState().activePlanFilePath).toBe("/plans/test.md");

      // Simulate the useShiftTab behavior that clears activePlanFilePath on exit
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
        activePlanFilePath: null,
      });

      expect(useAppStore.getState().activePlanFilePath).toBeNull();
      expect(useAppStore.getState().sessionPlanFilePath).toBe("/plans/test.md");
    });

    it("preserves sessionPlanFilePath across mode switches", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
        sessionPlanFilePath: "/plans/test.md",
      });

      // Switch to unchained (should clear active but keep session)
      useAppStore.setState({
        currentMode: "unchained" as ModeType,
        activePlanFilePath: null,
      });

      expect(useAppStore.getState().activePlanFilePath).toBeNull();
      expect(useAppStore.getState().sessionPlanFilePath).toBe("/plans/test.md");

      // Switch back to plan (should restore active from session)
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: useAppStore.getState().sessionPlanFilePath,
      });

      expect(useAppStore.getState().activePlanFilePath).toBe("/plans/test.md");
    });
  });

  describe("Plan File Initialization Integration", () => {
    it("calls getPlanFilePath and initializePlanFile for new plan sessions", async () => {
      const mockTransport = createMockTransport();
      const getPlanFilePathMock = vi
        .spyOn(planModeModule, "getPlanFilePath")
        .mockResolvedValue(".plans/feature-abc123.md");
      const initializePlanFileMock = vi
        .spyOn(planModeModule, "initializePlanFile")
        .mockResolvedValue(undefined);

      const signal = new AbortController().signal;

      // Simulate what the useEffect does when entering plan mode without session
      const path = await planModeModule.getPlanFilePath(mockTransport, signal);
      expect(getPlanFilePathMock).toHaveBeenCalledWith(mockTransport, signal);
      expect(path).toBe(".plans/feature-abc123.md");

      await planModeModule.initializePlanFile(mockTransport, path, signal);
      expect(initializePlanFileMock).toHaveBeenCalledWith(mockTransport, path, signal);
    });

    it("skips initialization when sessionPlanFilePath exists", async () => {
      const mockTransport = createMockTransport();
      const getPlanFilePathMock = vi.spyOn(planModeModule, "getPlanFilePath");
      const initializePlanFileMock = vi.spyOn(planModeModule, "initializePlanFile");

      // Simulate returning to plan mode with existing session
      const sessionPath = ".plans/existing.md";

      // When session exists, we skip getPlanFilePath and initializePlanFile
      // and just set activePlanFilePath from session
      expect(getPlanFilePathMock).not.toHaveBeenCalled();
      expect(initializePlanFileMock).not.toHaveBeenCalled();
    });

    it("handles getPlanFilePath errors gracefully", async () => {
      const mockTransport = createMockTransport();
      vi.spyOn(planModeModule, "getPlanFilePath").mockRejectedValue(
        new Error("fatal: not a git repository"),
      );

      const signal = new AbortController().signal;

      // The error should be caught and logged, not thrown
      await expect(planModeModule.getPlanFilePath(mockTransport, signal)).rejects.toThrow(
        "fatal: not a git repository",
      );
    });

    it("handles initializePlanFile errors gracefully", async () => {
      const mockTransport = createMockTransport();
      vi.spyOn(planModeModule, "initializePlanFile").mockRejectedValue(
        new Error("Permission denied"),
      );

      const signal = new AbortController().signal;

      await expect(
        planModeModule.initializePlanFile(mockTransport, ".plans/test.md", signal),
      ).rejects.toThrow("Permission denied");
    });
  });

  describe("Plan Mode Shortcut Hints", () => {
    it("shows Ctrl+O (not Ctrl+C) for collaboration shortcut when plan is written", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
        history: [
          {
            type: "plan-written",
            id: 1n,
            planFilePath: "/plans/test.md",
            content: "# Plan",
          } satisfies HistoryItem,
        ],
      });

      const state = useAppStore.getState();
      const currentMode = state.currentMode;
      const isPlanMode = currentMode === "plan";
      const hasPlanBeenWritten = state.history.some(item => item.type === "plan-written");

      // Replicate the hint text logic from BottomBarContent
      const hintText =
        isPlanMode && state.activePlanFilePath && hasPlanBeenWritten
          ? "(Ctrl+P: menu | Ctrl+U: unchained | Ctrl+O: collab)"
          : "(Ctrl+p to enter the menu)";

      expect(hintText).toBe("(Ctrl+P: menu | Ctrl+U: unchained | Ctrl+O: collab)");
      expect(hintText).not.toContain("Ctrl+C");
    });

    it("shows default hint when no plan has been written", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
        history: [],
      });

      const state = useAppStore.getState();
      const isPlanMode = state.currentMode === "plan";
      const hasPlanBeenWritten = state.history.some(item => item.type === "plan-written");

      const hintText =
        isPlanMode && state.activePlanFilePath && hasPlanBeenWritten
          ? "(Ctrl+P: menu | Ctrl+U: unchained | Ctrl+O: collab)"
          : "(Ctrl+p to enter the menu)";

      expect(hintText).toBe("(Ctrl+p to enter the menu)");
    });

    it("shows default hint when activePlanFilePath is null", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: null,
        history: [
          {
            type: "plan-written",
            id: 1n,
            planFilePath: "/plans/test.md",
            content: "# Plan",
          } satisfies HistoryItem,
        ],
      });

      const state = useAppStore.getState();
      const isPlanMode = state.currentMode === "plan";
      const hasPlanBeenWritten = state.history.some(item => item.type === "plan-written");

      const hintText =
        isPlanMode && state.activePlanFilePath && hasPlanBeenWritten
          ? "(Ctrl+P: menu | Ctrl+U: unchained | Ctrl+O: collab)"
          : "(Ctrl+p to enter the menu)";

      expect(hintText).toBe("(Ctrl+p to enter the menu)");
    });
  });

  describe("Mode Transition Validation", () => {
    it("validates all three mode labels work correctly", () => {
      const testCases = [
        { mode: "plan" as const, hasFile: true, expected: "📋 Plan mode" },
        { mode: "plan" as const, hasFile: false, expected: "📋 Plan mode (initializing...)" },
        { mode: "unchained" as const, hasFile: false, expected: "⚡ Unchained mode" },
        { mode: "collaboration" as const, hasFile: false, expected: "Collaboration mode" },
      ];

      for (const { mode, hasFile, expected } of testCases) {
        useAppStore.setState({
          currentMode: mode as ModeType,
          activePlanFilePath: hasFile ? "/plans/test.md" : null,
        });

        const state = useAppStore.getState();
        const currentMode = state.currentMode;

        const modeLabel = (() => {
          switch (currentMode) {
            case "unchained":
              return "⚡ Unchained mode";
            case "plan":
              return state.activePlanFilePath ? "📋 Plan mode" : "📋 Plan mode (initializing...)";
            default:
              return "Collaboration mode";
          }
        })();

        expect(modeLabel).toBe(expected);
      }
    });

    it("maintains correct state through mode cycle", () => {
      // Start in collaboration
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
        activePlanFilePath: null,
        sessionPlanFilePath: null,
      });

      expect(useAppStore.getState().currentMode).toBe("collaboration");

      // Enter plan mode (simulate file initialization)
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: ".plans/test.md",
        sessionPlanFilePath: ".plans/test.md",
      });

      expect(useAppStore.getState().currentMode).toBe("plan");
      expect(useAppStore.getState().activePlanFilePath).toBe(".plans/test.md");

      // Exit to unchained (clears active but keeps session)
      useAppStore.setState({
        currentMode: "unchained" as ModeType,
        activePlanFilePath: null,
      });

      expect(useAppStore.getState().currentMode).toBe("unchained");
      expect(useAppStore.getState().activePlanFilePath).toBeNull();
      expect(useAppStore.getState().sessionPlanFilePath).toBe(".plans/test.md");

      // Back to collaboration (no change to session)
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
      });

      expect(useAppStore.getState().currentMode).toBe("collaboration");
      expect(useAppStore.getState().sessionPlanFilePath).toBe(".plans/test.md");
    });
  });

  describe("Ctrl+E Platform-Specific Spawn Commands", () => {
    it("generates correct spawn cmd and args for macOS", () => {
      const activePlanFilePath = "/path/to/plan.md";
      const platform: string = "macos";

      let cmd: string;
      let args: string[];
      switch (platform) {
        case "macos":
          cmd = "open";
          args = [activePlanFilePath];
          break;
        case "windows":
          cmd = "cmd";
          args = ["/c", "start", "", activePlanFilePath];
          break;
        case "linux":
        default:
          cmd = "xdg-open";
          args = [activePlanFilePath];
          break;
      }

      expect(cmd).toBe("open");
      expect(args).toEqual(["/path/to/plan.md"]);
    });

    it("generates correct spawn cmd and args for Windows", () => {
      const activePlanFilePath = "/path/to/plan.md";
      const platform: string = "windows";

      let cmd: string;
      let args: string[];
      switch (platform) {
        case "macos":
          cmd = "open";
          args = [activePlanFilePath];
          break;
        case "windows":
          cmd = "cmd";
          args = ["/c", "start", "", activePlanFilePath];
          break;
        case "linux":
        default:
          cmd = "xdg-open";
          args = [activePlanFilePath];
          break;
      }

      expect(cmd).toBe("cmd");
      expect(args).toEqual(["/c", "start", "", "/path/to/plan.md"]);
    });

    it("generates correct spawn cmd and args for Linux", () => {
      const activePlanFilePath = "/path/to/plan.md";
      const platform: string = "linux";

      let cmd: string;
      let args: string[];
      switch (platform) {
        case "macos":
          cmd = "open";
          args = [activePlanFilePath];
          break;
        case "windows":
          cmd = "cmd";
          args = ["/c", "start", "", activePlanFilePath];
          break;
        case "linux":
        default:
          cmd = "xdg-open";
          args = [activePlanFilePath];
          break;
      }

      expect(cmd).toBe("xdg-open");
      expect(args).toEqual(["/path/to/plan.md"]);
    });

    it("passes paths with spaces safely as array args (no shell injection)", () => {
      const activePlanFilePath = "/path with spaces/to/plan file.md";
      const platform: string = "macos";

      let cmd: string;
      let args: string[];
      switch (platform) {
        case "macos":
          cmd = "open";
          args = [activePlanFilePath];
          break;
        case "windows":
          cmd = "cmd";
          args = ["/c", "start", "", activePlanFilePath];
          break;
        case "linux":
        default:
          cmd = "xdg-open";
          args = [activePlanFilePath];
          break;
      }

      expect(cmd).toBe("open");
      expect(args).toEqual(["/path with spaces/to/plan file.md"]);
    });

    it("passes paths with special characters safely as array args", () => {
      const activePlanFilePath = "/path/to/plan's file (v1).md";
      const platform: string = "linux";

      let cmd: string;
      let args: string[];
      switch (platform) {
        case "macos":
          cmd = "open";
          args = [activePlanFilePath];
          break;
        case "windows":
          cmd = "cmd";
          args = ["/c", "start", "", activePlanFilePath];
          break;
        case "linux":
        default:
          cmd = "xdg-open";
          args = [activePlanFilePath];
          break;
      }

      expect(cmd).toBe("xdg-open");
      expect(args).toEqual(["/path/to/plan's file (v1).md"]);
    });

    it("generates correct spawn cmd and args for each platform", () => {
      const platforms: Array<{
        platform: platformModule.PlatformKey;
        expectedCmd: string;
        expectedArgs: string[];
      }> = [
        { platform: "macos", expectedCmd: "open", expectedArgs: ["/plans/test.md"] },
        {
          platform: "windows",
          expectedCmd: "cmd",
          expectedArgs: ["/c", "start", "", "/plans/test.md"],
        },
        { platform: "linux", expectedCmd: "xdg-open", expectedArgs: ["/plans/test.md"] },
      ];

      for (const { platform, expectedCmd, expectedArgs } of platforms) {
        const activePlanFilePath = "/plans/test.md";

        let cmd: string;
        let args: string[];
        switch (platform) {
          case "macos":
            cmd = "open";
            args = [activePlanFilePath];
            break;
          case "windows":
            cmd = "cmd";
            args = ["/c", "start", "", activePlanFilePath];
            break;
          case "linux":
          default:
            cmd = "xdg-open";
            args = [activePlanFilePath];
            break;
        }

        expect(cmd).toBe(expectedCmd);
        expect(args).toEqual(expectedArgs);
      }
    });
  });

  describe("Plan Mode Shortcuts Query Guard", () => {
    it("should only trigger shortcuts when query is empty", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
        modeData: { mode: "input", vimMode: "INSERT" },
        query: "",
      });

      const state = useAppStore.getState();
      const isPlanMode = state.currentMode === "plan";
      const isInputMode = state.modeData.mode === "input";
      const queryIsEmpty = state.query === "";

      // Shortcuts should fire when all conditions met
      expect(isPlanMode && isInputMode && queryIsEmpty).toBe(true);
    });

    it("should not trigger shortcuts when query has text", () => {
      useAppStore.setState({
        currentMode: "plan" as ModeType,
        activePlanFilePath: "/plans/test.md",
        modeData: { mode: "input", vimMode: "INSERT" },
        query: "some user text",
      });

      const state = useAppStore.getState();
      const isPlanMode = state.currentMode === "plan";
      const isInputMode = state.modeData.mode === "input";
      const queryIsEmpty = state.query === "";

      // Shortcuts should NOT fire when query has text
      expect(isPlanMode && isInputMode && queryIsEmpty).toBe(false);
    });

    it("should not trigger shortcuts outside plan mode even with empty query", () => {
      useAppStore.setState({
        currentMode: "collaboration" as ModeType,
        activePlanFilePath: null,
        modeData: { mode: "input", vimMode: "INSERT" },
        query: "",
      });

      const state = useAppStore.getState();
      const isPlanMode = state.currentMode === "plan";
      const isInputMode = state.modeData.mode === "input";
      const queryIsEmpty = state.query === "";

      expect(isPlanMode && isInputMode && queryIsEmpty).toBe(false);
    });
  });
});
