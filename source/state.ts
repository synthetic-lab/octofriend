import { Config, useConfig, getModelFromConfig, assertKeyForModel } from "./config.ts";
import {
  HistoryItem,
  UserItem,
  AssistantItem,
  CompactionCheckpointItem,
  sequenceId,
} from "./history.ts";
import { runTool, ToolError, loadTools, PLAN_MODE_TOOLS } from "./tools/index.ts";
import { ModeType, PlanModeConfig } from "./modes.ts";
import { initializePlanFile } from "./plan-mode.ts";
import { create } from "zustand";
import { FileOutdatedError, fileTracker } from "./tools/file-tracker.ts";
import * as path from "path";
import { useShallow } from "zustand/shallow";
import { toLlmIR, outputToHistory } from "./ir/convert-history-ir.ts";
import { PaymentError, RateLimitError, CompactionRequestError } from "./errors.ts";
import { Transport } from "./transports/transport-common.ts";
import { trajectoryArc } from "./agent/trajectory-arc.ts";
import { ToolCallRequest } from "./ir/llm-ir.ts";
import { throttledBuffer } from "./throttled-buffer.ts";
import * as logger from "./logger.ts";
import { displayPath } from "./str.ts";

export type RunArgs = {
  config: Config;
  transport: Transport;
};

export type InflightResponseType = Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens">;
export type UiState = {
  modeData:
    | {
        mode: "input";
        vimMode: "NORMAL" | "INSERT";
      }
    | {
        mode: "responding";
        inflightResponse: InflightResponseType;
        abortController: AbortController;
      }
    | {
        mode: "tool-request";
        toolReq: ToolCallRequest;
      }
    | {
        mode: "error-recovery";
      }
    | {
        mode: "payment-error";
        error: string;
      }
    | {
        mode: "rate-limit-error";
        error: string;
      }
    | {
        mode: "request-error";
        error: string;
        curlCommand: string | null;
      }
    | {
        mode: "compaction-error";
        error: string;
        curlCommand: string | null;
      }
    | {
        mode: "diff-apply";
        abortController: AbortController;
      }
    | {
        mode: "fix-json";
        abortController: AbortController;
      }
    | {
        mode: "compacting";
        inflightResponse: InflightResponseType;
        abortController: AbortController;
      }
    | {
        mode: "menu";
      }
    | {
        mode: "tool-waiting";
        abortController: AbortController;
      };
  modelOverride: string | null;
  byteCount: number;
  query: string;
  history: Array<HistoryItem>;
  clearNonce: number;
  currentMode: ModeType;
  /** Path currently being used by agent tools for plan operations.
   * This is the active plan file that tools read from/write to.
   * Set when entering plan mode, cleared when exiting.
   */
  activePlanFilePath: string | null;
  /** Path allocated for this session (survives mode switches).
   * This persists even when switching to other modes so the plan
   * can be resumed later. Cleared when session is cleared.
   */
  sessionPlanFilePath: string | null;
  /** Tracks whether the plan file has been initialized (created with template).
   * Used to ensure lazy initialization only happens once per session.
   */
  planFileInitialized: boolean;
  input: (args: RunArgs & { query: string }) => Promise<void>;
  runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>;
  rejectTool: (toolCallId: string) => void;
  abortResponse: () => void;
  toggleMenu: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  setVimMode: (vimMode: "INSERT" | "NORMAL") => void;
  setModelOverride: (m: string) => void;
  setQuery: (query: string) => void;
  retryFrom: (
    mode: "payment-error" | "rate-limit-error" | "request-error" | "compaction-error",
    args: RunArgs,
  ) => Promise<void>;
  notify: (notif: string) => void;
  _maybeHandleAbort: (signal: AbortSignal) => boolean;
  _runAgent: (args: RunArgs) => Promise<void>;
  clearHistory: () => void;
  setActivePlanFilePath: (path: string | null) => void;
  setSessionPlanFilePath: (path: string | null) => void;
  setPlanFileInitialized: (initialized: boolean) => void;
  setMode: (mode: ModeType) => void;
  exitPlanModeAndImplement: (
    config: Config,
    transport: Transport,
    targetMode: "collaboration" | "unchained",
  ) => Promise<void>;
};

export const useAppStore = create<UiState>((set, get) => ({
  modeData: {
    mode: "input" as const,
    vimMode: "INSERT" as const,
  },
  history: [],
  modelOverride: null,
  byteCount: 0,
  query: "",
  clearNonce: 0,
  currentMode: "collaboration",
  activePlanFilePath: null,
  sessionPlanFilePath: null,
  planFileInitialized: false,

  input: async ({ config, query, transport }) => {
    const userMessage: UserItem = {
      type: "user",
      id: sequenceId(),
      content: query,
    };

    let history = [...get().history, userMessage];
    set({ history });
    await get()._runAgent({ config, transport });
  },

  retryFrom: async (mode, args) => {
    if (get().modeData.mode === mode) {
      await get()._runAgent(args);
    }
  },

  rejectTool: toolCallId => {
    set({
      history: [
        ...get().history,
        {
          type: "tool-reject",
          id: sequenceId(),
          toolCallId,
        },
      ],
      modeData: {
        mode: "input",
        vimMode: "INSERT",
      },
    });
  },

  abortResponse: () => {
    const { modeData } = get();
    if ("abortController" in modeData) modeData.abortController.abort();
  },

  _maybeHandleAbort: (signal: AbortSignal): boolean => {
    if (signal.aborted) {
      set({
        modeData: {
          mode: "input",
          vimMode: "INSERT",
        },
      });
      return true;
    }
    return false;
  },

  toggleMenu: () => {
    const { modeData } = get();
    if (modeData.mode === "input") {
      set({
        modeData: { mode: "menu" },
      });
    } else if (modeData.mode === "menu") {
      set({
        modeData: { mode: "input", vimMode: "NORMAL" },
      });
    }
  },
  closeMenu: () => {
    set({
      modeData: { mode: "input", vimMode: "INSERT" },
    });
  },
  openMenu: () => {
    set({
      modeData: { mode: "menu" },
    });
  },

  setVimMode: (vimMode: "INSERT" | "NORMAL") => {
    const { modeData } = get();
    if (modeData.mode === "input") {
      set({
        modeData: { mode: "input", vimMode },
      });
    }
  },

  setQuery: query => {
    set({ query });
  },

  setModelOverride: model => {
    set({
      modelOverride: model,
      history: [
        ...get().history,
        {
          type: "notification",
          id: sequenceId(),
          content: `Model: ${model}`,
        },
      ],
    });
  },

  notify: notif => {
    set({
      history: [
        ...get().history,
        {
          type: "notification",
          id: sequenceId(),
          content: notif,
        },
      ],
    });
  },

  clearHistory: () => {
    // Abort any ongoing responses to avoid polluting the new cleared state.
    const { abortResponse } = get();
    abortResponse();

    set(state => ({
      history: [],
      byteCount: 0,
      clearNonce: state.clearNonce + 1,
      sessionPlanFilePath: null,
      activePlanFilePath: null,
      planFileInitialized: false,
    }));
  },

  setActivePlanFilePath: (path: string | null) => {
    if (path === null && get().currentMode === "plan") {
      logger.error("verbose", "Warning: Clearing activePlanFilePath while in plan mode");
    }
    set({ activePlanFilePath: path });
  },

  setSessionPlanFilePath: (path: string | null) => {
    set({ sessionPlanFilePath: path });
  },

  setPlanFileInitialized: (initialized: boolean) => {
    set({ planFileInitialized: initialized });
  },

  setMode: (mode: ModeType) => {
    set({ currentMode: mode });
  },

  /**
   * Exits plan mode, reads the plan file, and begins implementation in the specified mode.
   *
   * This method:
   * 1. Reads the plan file content
   * 2. Clears all conversation history
   * 3. Transitions to the specified execution mode (collaboration or unchained)
   * 4. Sends the plan content as a new user message to start implementation
   *
   * Side effects:
   * - Clears all conversation history
   * - Changes the operating mode
   * - Sends a new user message with plan content
   *
   * @param config - Application config for tool execution
   * @param transport - Transport interface for file operations
   * @param targetMode - The execution mode to switch to ("collaboration" or "unchained")
   * @throws Errors from input/agent execution propagate to the caller
   */
  exitPlanModeAndImplement: async (
    config: Config,
    transport: Transport,
    targetMode: "collaboration" | "unchained",
  ) => {
    const { notify, input, activePlanFilePath } = get();

    if (!activePlanFilePath) {
      notify("No plan file available. Cannot exit plan mode.");
      return;
    }

    let planContent = "";
    try {
      const abortController = new AbortController();
      planContent = await transport.readFile(abortController.signal, activePlanFilePath);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("info", "Failed to read plan file in exitPlanModeAndImplement", {
        activePlanFilePath,
        error: errorMessage,
      });
      notify(
        `Failed to read plan file at ${displayPath(activePlanFilePath)}. Please try again or describe what you want to implement.`,
      );
      return;
    }

    const modeName = targetMode === "collaboration" ? "Collaboration" : "Unchained";

    if (!planContent) {
      notify(
        "Plan is empty - no content to implement. Please write a plan first, then exit plan mode.",
      );
      return;
    }

    const { abortResponse } = get();
    abortResponse();
    set(state => ({
      history: [],
      byteCount: 0,
      clearNonce: state.clearNonce + 1,
      sessionPlanFilePath: null,
      activePlanFilePath: null,
      planFileInitialized: false,
      currentMode: targetMode,
      modeData: { mode: "input", vimMode: "INSERT" },
    }));

    notify(`Exited plan mode. Entering ${modeName} mode. Beginning implementation from plan.`);
    await input({
      config,
      transport,
      query: `Please implement the following plan:\n\n${planContent}`,
    });
  },

  runTool: async ({ config, toolReq, transport }) => {
    const modelOverride = get().modelOverride;
    const abortController = new AbortController();
    const isPlanMode = get().currentMode === "plan";
    const { activePlanFilePath } = get();

    set({
      modeData: {
        mode: "tool-waiting",
        abortController,
      },
    });

    const tools = await loadTools(
      transport,
      abortController.signal,
      config,
      isPlanMode ? PLAN_MODE_TOOLS : undefined,
      isPlanMode ? activePlanFilePath : null,
    );

    try {
      const result = await runTool(
        abortController.signal,
        transport,
        tools,
        toolReq.function,
        config,
        modelOverride,
      );

      if (toolReq.function.name === "write-plan") {
        const planPath = get().activePlanFilePath ?? activePlanFilePath;
        if (!planPath) {
          throw new ToolError("Plan file path became unavailable during write. Please retry.");
        }
        const toolOutputItem: HistoryItem = {
          type: "tool-output",
          id: sequenceId(),
          result,
          toolCallId: toolReq.toolCallId,
        };
        const planWrittenItem: HistoryItem = {
          type: "plan-written",
          id: sequenceId(),
          planFilePath: planPath,
          content: result != null && "content" in result ? result.content : String(result),
        };
        set({ history: [...get().history, toolOutputItem, planWrittenItem] });
      } else {
        const toolHistoryItem: HistoryItem = {
          type: "tool-output",
          id: sequenceId(),
          result,
          toolCallId: toolReq.toolCallId,
        };
        set({ history: [...get().history, toolHistoryItem] });
      }
    } catch (e) {
      const history = [
        ...get().history,
        await tryTransformToolError(abortController.signal, transport, toolReq, e),
      ];
      set({ history });
    }

    if (get()._maybeHandleAbort(abortController.signal)) {
      return;
    }
    await get()._runAgent({ config, transport });
  },

  _runAgent: async ({ config, transport }) => {
    const historyCopy = [...get().history];
    const abortController = new AbortController();
    let compactionByteCount = 0;
    let responseByteCount = 0;
    const model = getModelFromConfig(config, get().modelOverride);
    const apiKey = await assertKeyForModel(model, config);
    const isPlanMode = get().currentMode === "plan";
    const { activePlanFilePath, planFileInitialized } = get();

    // Lazy initialization of plan file on first message in plan mode
    if (isPlanMode && activePlanFilePath && !planFileInitialized) {
      try {
        await initializePlanFile(transport, activePlanFilePath, abortController.signal);
        set({ planFileInitialized: true });
      } catch (initErr) {
        if (abortController.signal.aborted) return;
        const errorCode =
          initErr instanceof Error && "code" in initErr
            ? String((initErr as NodeJS.ErrnoException).code)
            : "UNKNOWN";
        if (SYSTEM_ERROR_CODES.includes(errorCode)) throw initErr;
        const errorMessage = initErr instanceof Error ? initErr.message : String(initErr);
        logger.error("info", "Plan file initialization failed", {
          planFilePath: activePlanFilePath,
          error: errorMessage,
        });
        get().notify(
          `Plan mode: failed to initialize plan file at ${displayPath(activePlanFilePath)}. You can create it manually.`,
        );
      }
    }

    let planModeConfig: PlanModeConfig;
    if (isPlanMode) {
      if (activePlanFilePath === null) {
        throw new Error(
          "Invariant violation: activePlanFilePath is null when isPlanMode is true. Mode switching logic should ensure this never happens.",
        );
      }
      planModeConfig = { isPlanMode: true, planFilePath: activePlanFilePath };
    } else {
      planModeConfig = { isPlanMode: false };
    }

    const throttle = throttledBuffer<Partial<Parameters<typeof set>[0]>>(200, set);

    try {
      const finish = await trajectoryArc({
        apiKey,
        model,
        messages: toLlmIR(historyCopy),
        config,
        transport,
        abortSignal: abortController.signal,
        planModeConfig,
        handler: {
          startResponse: () => {
            throttle.flush();
            set({
              modeData: {
                mode: "responding",
                inflightResponse: {
                  type: "assistant",
                  content: "",
                },
                abortController,
              },
              byteCount: responseByteCount,
            });
          },

          responseProgress: event => {
            responseByteCount += event.delta.value.length;
            throttle.emit({
              modeData: {
                mode: "responding",
                inflightResponse: {
                  type: "assistant",
                  reasoningContent: event.buffer.reasoning,
                  content: event.buffer.content || "",
                },
                abortController,
              },
              byteCount: responseByteCount,
            });
          },

          startCompaction: () => {
            throttle.flush();
            set({
              modeData: {
                mode: "compacting",
                inflightResponse: {
                  type: "assistant",
                  content: "",
                },
                abortController,
              },
              byteCount: compactionByteCount,
            });
          },

          compactionProgress: event => {
            compactionByteCount += event.delta.value.length;
            throttle.emit({
              modeData: {
                mode: "compacting",
                inflightResponse: {
                  type: "assistant",
                  reasoningContent: event.buffer.reasoning,
                  content: event.buffer.content || "",
                },
                abortController,
              },
              byteCount: compactionByteCount,
            });
          },

          compactionParsed: event => {
            throttle.flush();
            const checkpointItem: CompactionCheckpointItem = {
              type: "compaction-checkpoint",
              id: sequenceId(),
              summary: event.checkpoint.summary,
            };
            set({ history: [...historyCopy, checkpointItem] });
          },

          autofixingJson: () => {
            throttle.flush();
            set({
              modeData: {
                mode: "fix-json",
                abortController,
              },
            });
          },

          autofixingDiff: () => {
            throttle.flush();
            set({
              modeData: {
                mode: "diff-apply",
                abortController,
              },
            });
          },

          retryTool: event => {
            throttle.flush();
            set({ history: [...historyCopy, ...outputToHistory(event.irs)] });
          },
        },
      });
      throttle.flush();
      historyCopy.push(...outputToHistory(finish.irs));
      set({ history: [...historyCopy] });
      const finishReason = finish.reason;
      if (finishReason.type === "abort" || finishReason.type === "needs-response") {
        set({ modeData: { mode: "input", vimMode: "INSERT" } });
        return;
      }

      if (finishReason.type === "request-error") {
        set({
          modeData: {
            mode: "request-error",
            error: finishReason.requestError,
            curlCommand: finishReason.curl,
          },
        });
        return;
      }

      set({
        modeData: {
          mode: "tool-request",
          toolReq: finishReason.toolCall,
        },
      });
    } catch (e) {
      if (e instanceof CompactionRequestError) {
        set({
          modeData: {
            mode: "compaction-error",
            error: e.requestError,
            curlCommand: e.curl,
          },
          history: [
            ...get().history,
            {
              type: "compaction-failed",
              id: sequenceId(),
            },
          ],
        });
        return;
      }
      if (get()._maybeHandleAbort(abortController.signal)) {
        return;
      }

      if (e instanceof PaymentError) {
        set({ modeData: { mode: "payment-error", error: e.message } });
        return;
      } else if (e instanceof RateLimitError) {
        set({ modeData: { mode: "rate-limit-error", error: e.message } });
        return;
      }

      throw e;
    } finally {
      set({ byteCount: 0 });
    }
  },
}));

const SYSTEM_ERROR_CODES = ["EMFILE", "ENFILE", "ENOMEM", "EACCES", "EPERM", "ENOSPC", "EIO"];

/**
 * Transforms tool errors into appropriate history items.
 *
 * Handles known error types (ToolError, FileOutdatedError) by converting them
 * into user-friendly history items. System-level errors (EMFILE, ENOMEM) are
 * re-thrown to prevent masking critical issues.
 *
 * @param signal - Abort signal for file operations
 * @param transport - The transport interface for file system operations
 * @param toolReq - The tool request that caused the error
 * @param e - The error that occurred
 * @returns A history item describing the error
 * @throws {Error} System-level errors (EMFILE, ENOMEM) that should not be
 *         converted to user messages
 * @throws {Error} Unexpected errors not categorized as ToolError or FileOutdatedError
 */
async function tryTransformToolError(
  signal: AbortSignal,
  transport: Transport,
  toolReq: ToolCallRequest,
  e: unknown,
): Promise<HistoryItem> {
  if (e instanceof ToolError) {
    return {
      type: "tool-failed",
      id: sequenceId(),
      error: e.message,
      toolCallId: toolReq.toolCallId,
      toolName: toolReq.function.name,
    };
  }
  if (e instanceof FileOutdatedError) {
    const absolutePath = path.resolve(e.filePath);
    // Actually perform the read to ensure it's readable
    try {
      await fileTracker.readUntracked(transport, signal, absolutePath);
      return {
        type: "file-outdated",
        id: sequenceId(),
        toolCallId: toolReq.toolCallId,
        error:
          "File could not be updated because it was modified after being last read. Please read the file again before modifying it.",
      };
    } catch (readErr) {
      const errorMessage = readErr instanceof Error ? readErr.message : String(readErr);
      const errorCode =
        readErr instanceof Error && "code" in readErr
          ? String((readErr as NodeJS.ErrnoException).code)
          : "UNKNOWN";

      if (SYSTEM_ERROR_CODES.includes(errorCode)) {
        logger.error("info", "System-level error during file-outdated check, re-throwing", {
          filePath: e.filePath,
          toolName: toolReq.function.name,
          errorCode,
          errorMessage,
        });
        throw readErr;
      }

      // Expected file errors (ENOENT, etc.) - convert to user message
      logger.log("info", "FileTracker.readUntracked failed during file-outdated check", {
        filePath: e.filePath,
        toolName: toolReq.function.name,
        error: errorMessage,
        errorCode,
      });
      return {
        type: "file-unreadable",
        path: e.filePath,
        id: sequenceId(),
        toolCallId: toolReq.toolCallId,
        error: `File ${e.filePath} could not be read. Has it been deleted?`,
      };
    }
  }
  // Unknown error type - re-throw to avoid masking issues
  const errorMessage = e instanceof Error ? e.message : String(e);
  logger.error("info", "Unknown error type in tryTransformToolError, re-throwing", {
    errorMessage,
    toolName: toolReq.function.name,
  });
  throw e;
}

export function useModel() {
  const { modelOverride } = useAppStore(
    useShallow(state => ({
      modelOverride: state.modelOverride,
    })),
  );
  const config = useConfig();

  return getModelFromConfig(config, modelOverride);
}
