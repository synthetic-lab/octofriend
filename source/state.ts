import { Config, useConfig, getModelFromConfig, assertKeyForModel } from "./config.ts";
import {
  HistoryItem,
  UserItem,
  AssistantItem,
  CompactionCheckpointItem,
  sequenceId,
} from "./history.ts";
import { runTool, ToolError, loadTools, PLAN_MODE_TOOLS } from "./tools/index.ts";
import { MODES, PlanModeConfig } from "./modes.ts";
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
  /**
   * Index into MODES array.
   *
   * Valid range: 0 to MODES.length - 1 (0=collaboration, 1=unchained, 2=plan)
   *
   * Note: The bounds of this index are not enforced at the type level. Runtime code
   * should ensure valid indices are used when accessing MODES[modeIndex].
   */
  modeIndex: number;
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
  setModeIndex: (index: number) => void;
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
  modeIndex: 0,
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
    set({ activePlanFilePath: path });
  },

  setSessionPlanFilePath: (path: string | null) => {
    set({ sessionPlanFilePath: path });
  },

  setPlanFileInitialized: (initialized: boolean) => {
    set({ planFileInitialized: initialized });
  },

  setModeIndex: (index: number) => {
    set({
      modeIndex: index,
    });
  },

  exitPlanModeAndImplement: async (
    config: Config,
    transport: Transport,
    targetMode: "collaboration" | "unchained",
  ) => {
    const { clearHistory, notify, input, activePlanFilePath } = get();

    if (!activePlanFilePath) {
      notify("No plan file available. Cannot exit plan mode.");
      return;
    }

    // Read the plan file content
    let planContent = "";
    try {
      const signal = new AbortController().signal;
      planContent = await transport.readFile(signal, activePlanFilePath);
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

    const modeIndex = MODES.indexOf(targetMode);

    clearHistory();
    set({
      modeIndex,
      activePlanFilePath: null,
      modeData: { mode: "input", vimMode: "INSERT" },
    });

    if (planContent) {
      notify(`Exited plan mode. Entering ${modeName} mode. Beginning implementation from plan.`);
      await input({
        config,
        transport,
        query: `Please implement the following plan:\n\n${planContent}`,
      });
    } else {
      notify(
        `Exited plan mode. Entering ${modeName} mode. No plan content found - please describe what you want to implement.`,
      );
    }
  },

  runTool: async ({ config, toolReq, transport }) => {
    const modelOverride = get().modelOverride;
    const abortController = new AbortController();
    const currentMode = MODES[get().modeIndex];
    const isPlanMode = currentMode === "plan";
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

      let toolHistoryItem: HistoryItem;
      if (toolReq.function.name === "write-plan") {
        const planPath = get().activePlanFilePath ?? activePlanFilePath;
        if (!planPath) {
          throw new ToolError("Plan file path became unavailable during write. Please retry.");
        }
        toolHistoryItem = {
          type: "plan-written",
          id: sequenceId(),
          planFilePath: planPath,
          content: result != null && "content" in result ? result.content : String(result),
        };
      } else {
        toolHistoryItem = {
          type: "tool-output",
          id: sequenceId(),
          result,
          toolCallId: toolReq.toolCallId,
        };
      }

      const history: HistoryItem[] = [...get().history, toolHistoryItem];
      set({ history });
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
    const currentMode = MODES[get().modeIndex];
    const isPlanMode = currentMode === "plan";
    const { activePlanFilePath, planFileInitialized } = get();

    // Lazy initialization of plan file on first message in plan mode
    if (isPlanMode && activePlanFilePath && !planFileInitialized) {
      try {
        await initializePlanFile(transport, activePlanFilePath, abortController.signal);
        set({ planFileInitialized: true });
      } catch (initErr) {
        if (abortController.signal.aborted) return;
        const errorMessage = initErr instanceof Error ? initErr.message : String(initErr);
        logger.error("info", "Plan file initialization failed", {
          planFilePath: activePlanFilePath,
          error: errorMessage,
        });
        get().notify(
          `Plan mode: failed to initialize plan file at ${activePlanFilePath}. You can create it manually.`,
        );
      }
    }
    const planModeConfig: PlanModeConfig = isPlanMode
      ? {
          isPlanMode: true,
          planFilePath: (() => {
            // Type assertion: we guarantee activePlanFilePath is non-null when isPlanMode is true
            // This is a runtime invariant enforced by the mode switching logic
            if (activePlanFilePath === null) {
              throw new Error(
                "Invariant violation: activePlanFilePath is null when isPlanMode is true. Mode switching logic should ensure this never happens.",
              );
            }
            return activePlanFilePath;
          })(),
        }
      : { isPlanMode: false };

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

      // System-level errors that should not be converted to user messages
      const SYSTEM_ERROR_CODES = ["EMFILE", "ENFILE", "ENOMEM", "EACCES", "EPERM", "ENOSPC", "EIO"];
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
