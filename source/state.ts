import {
  Config,
  useConfig,
  getModelFromConfig,
  assertKeyForModel,
  runNotifyCommand,
} from "./config.ts";
import {
  HistoryItem,
  UserItem,
  AssistantItem,
  CompactionCheckpointItem,
  ToolOutputItem,
  ToolCallItems,
  sequenceId,
} from "./history.ts";
import { ImageInfo } from "./utils/image-utils.ts";
import { runTool, ToolError } from "./tools/index.ts";
import { create } from "zustand";
import { FileOutdatedError, fileTracker } from "./tools/file-tracker.ts";
import * as path from "path";
import { useShallow } from "zustand/shallow";
import { toLlmIR, outputToHistory } from "./ir/convert-history-ir.ts";
import { PaymentError, RateLimitError, CompactionRequestError } from "./errors.ts";
import { Transport } from "./transports/transport-common.ts";
import { trajectoryArc } from "./agent/trajectory-arc.ts";
import { ToolCallRequest } from "./ir/llm-ir.ts";
import { QuotaData } from "./utils/quota.ts";
import { throttledBuffer } from "./throttled-buffer.ts";
import { loadTools } from "./tools/index.ts";

export type RunArgs = {
  config: Config;
  transport: Transport;
};

export type InflightResponseType = Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens">;
export type UiState = {
  preMenuModeData: UiState["modeData"] | null;
  _notifyTimer: NodeJS.Timeout | null;
  sessionAutoNotify: boolean;
  notifyOnce: boolean;
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
        toolReqs: ToolCallRequest[];
        runningToolCallId: string | null;
        abortController: AbortController;
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
      };

  modelOverride: string | null;
  quotaData: QuotaData | null;
  byteCount: number;
  query: string;
  history: Array<HistoryItem>;
  clearNonce: number;
  lastUserPromptId: bigint | null;
  whitelist: Set<string>;
  notifyReadyForInput: (config: Config) => void;
  cancelNotifyReadyForInput: () => void;
  setNotifyOnce: (notifyOnce: boolean) => void;
  setNotifySession: (notifySession: boolean) => void;
  input: (args: RunArgs & { query: string; images?: ImageInfo[] }) => Promise<void>;
  runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>;
  rejectTool: (toolCall: ToolCallRequest) => void;
  abortResponse: () => void;
  toggleMenu: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  setVimMode: (vimMode: "INSERT" | "NORMAL") => void;
  resetPreMenuVimMode: () => void;
  setModelOverride: (m: string) => void;
  setQuery: (query: string) => void;
  retryFrom: (
    mode: "payment-error" | "rate-limit-error" | "request-error" | "compaction-error",
    args: RunArgs,
  ) => Promise<void>;
  editAndRetryFrom: (mode: "request-error" | "compaction-error", args: RunArgs) => void;
  notify: (notif: string) => void;
  addToWhitelist: (whitelistKey: string) => Promise<void>;
  isWhitelisted: (whitelistKey: string) => Promise<boolean>;
  clearHistory: () => void;
  _maybeHandleAbort: (signal: AbortSignal) => boolean;
  runAgent: (args: RunArgs) => Promise<void>;
};

export const useAppStore = create<UiState>((set, get) => ({
  preMenuModeData: null,
  _notifyTimer: null,
  sessionAutoNotify: false,
  notifyOnce: false,
  modeData: {
    mode: "input" as const,
    vimMode: "INSERT" as const,
  },
  history: [],
  modelOverride: null,
  quotaData: null,
  byteCount: 0,
  query: "",
  clearNonce: 0,
  lastUserPromptId: null,
  whitelist: new Set<string>(),

  setNotifyOnce: notifyOnce => {
    set({ notifyOnce });
  },

  setNotifySession: sessionAutoNotify => {
    set({ sessionAutoNotify });
  },

  notifyReadyForInput: config => {
    const { sessionAutoNotify, notifyOnce } = get();

    if (notifyOnce) {
      set({ notifyOnce: false });
      // fall through to schedule notification
    } else if (config.notifications?.alwaysNotify || sessionAutoNotify) {
      // fall through to schedule notification
    } else {
      return;
    }

    const notifyTimeout = (() => {
      if (notifyOnce) return 0;
      return config.notifications?.notifyTimeoutMs ?? 10_000;
    })();

    const timer = setTimeout(async () => {
      await runNotifyCommand(config);
    }, notifyTimeout);

    set({ _notifyTimer: timer });
  },

  cancelNotifyReadyForInput: () => {
    const { _notifyTimer } = get();
    if (_notifyTimer) {
      clearTimeout(_notifyTimer);
      set({ _notifyTimer: null });
    }
  },

  input: async ({ config, query, transport, images }) => {
    const userMessage: UserItem = {
      type: "user",
      id: sequenceId(),
      content: query,
      images: images && images.length > 0 ? images : undefined,
    };

    let history = [...get().history, userMessage];
    set({ history, lastUserPromptId: userMessage.id });
    await get().runAgent({ config, transport });
  },

  retryFrom: async (mode, args) => {
    if (get().modeData.mode === mode) {
      await get().runAgent(args);
    }
  },

  editAndRetryFrom: (mode, _args) => {
    if (get().modeData.mode !== mode) {
      return;
    }

    const { history, lastUserPromptId } = get();

    if (lastUserPromptId === null) {
      set({
        query: "",
        byteCount: 0,
        modeData: { mode: "input", vimMode: "INSERT" },
      });
      return;
    }

    const lastUserItem = history.find(item => item.id === lastUserPromptId);
    if (!lastUserItem || lastUserItem.type !== "user") {
      set({
        query: "",
        byteCount: 0,
        modeData: { mode: "input", vimMode: "INSERT" },
      });
      return;
    }

    const filteredHistory = history.filter(item => item.id < lastUserPromptId);
    set(state => ({
      history: filteredHistory,
      query: lastUserItem.content,
      byteCount: 0,
      clearNonce: state.clearNonce + 1,
      modeData: { mode: "input", vimMode: "INSERT" },
    }));
  },

  rejectTool: toolCall => {
    const history = get().history;

    // If we reject a tool call, we need to mark all subsequent tool calls as skipped, so the LLM
    // knows we rejected partway through and didn't run the rest of the array of tools.
    //
    // Find the most recent set of tool calls, and attempt to find any tool calls subsequent to this
    // one that may be skipped, and mark them all as skipped.
    let lastToolCallIndex = history.length - 1;
    for (lastToolCallIndex; lastToolCallIndex >= 0; lastToolCallIndex--) {
      const item = history[lastToolCallIndex];
      if (item.type === "tool-calls") break;
    }
    const skippedCalls: HistoryItem[] = [];

    if (lastToolCallIndex >= 0) {
      const originatingToolCalls = history[lastToolCallIndex] as ToolCallItems;
      for (
        let toolCallIndex = 0;
        toolCallIndex < originatingToolCalls.tools.length;
        toolCallIndex++
      ) {
        const call = originatingToolCalls.tools[toolCallIndex];
        if (call.toolCallId === toolCall.toolCallId && call.type === "tool-request") {
          const skippedCount = originatingToolCalls.tools.length - toolCallIndex - 1;
          if (skippedCount > 0) {
            for (let i = 0; i < skippedCount; i++) {
              skippedCalls.push({
                id: sequenceId(),
                type: "tool-skip",
                toolCall: call,
                reason: "A previous tool call was rejected, so this tool was skipped",
              });
            }
          }
          break;
        }
      }
    }
    set({
      history: [
        ...get().history,
        {
          type: "tool-reject",
          id: sequenceId(),
          toolCall,
        },
        ...skippedCalls,
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
        preMenuModeData: modeData,
      });
    } else if (modeData.mode === "menu") {
      const { preMenuModeData } = get();
      set({
        modeData: preMenuModeData ?? { mode: "input", vimMode: "INSERT" },
        preMenuModeData: null,
      });
    }
  },
  closeMenu: () => {
    const { preMenuModeData } = get();
    set({
      modeData: preMenuModeData ?? { mode: "input", vimMode: "INSERT" },
      preMenuModeData: null,
    });
  },
  openMenu: () => {
    const { modeData } = get();
    set({
      modeData: { mode: "menu" },
      preMenuModeData: modeData,
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

  resetPreMenuVimMode: () => {
    const { preMenuModeData } = get();
    if (preMenuModeData?.mode === "input") {
      set({ preMenuModeData: { ...preMenuModeData, vimMode: "INSERT" } });
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
    }));
  },

  addToWhitelist: async (whitelistKey: string) => {
    const currentWhitelist = get().whitelist;
    const newWhitelist = new Set(currentWhitelist);
    newWhitelist.add(whitelistKey);
    set({ whitelist: newWhitelist });
  },

  isWhitelisted: async (whitelistKey: string) => {
    return get().whitelist.has(whitelistKey);
  },

  runTool: async ({ config, toolReq, transport }) => {
    let { modeData } = get();
    if (modeData.mode !== "tool-request") {
      throw new Error(`Impossible tool mode: ${modeData.mode}`);
    }
    if (modeData.runningToolCallId != null) {
      if (process.env["CANARY_OCTO"] === "1") {
        throw new Error(
          "Canary build error: attempted to run a tool when a tool was already running",
        );
      }
    }

    const abortController = modeData.abortController;
    set({ modeData: { ...modeData, runningToolCallId: toolReq.toolCallId } });

    const modelOverride = get().modelOverride;
    const tools = await loadTools(transport, abortController.signal, config);

    try {
      const result = await runTool(
        abortController.signal,
        transport,
        tools,
        toolReq.call,
        config,
        modelOverride,
      );

      const toolHistoryItem: ToolOutputItem = {
        type: "tool-output",
        id: sequenceId(),
        result,
        toolCall: toolReq,
      };

      set({ history: [...get().history, toolHistoryItem] });
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

    ({ modeData } = get());
    if (modeData.mode === "tool-request") {
      set({ modeData: { ...modeData, runningToolCallId: null } });
    }
  },

  runAgent: async ({ config, transport }) => {
    const historyCopy = [...get().history];
    const abortController = new AbortController();
    let compactionByteCount = 0;
    let responseByteCount = 0;
    const model = getModelFromConfig(config, get().modelOverride);
    const apiKey = await assertKeyForModel(model, config);

    const throttle = throttledBuffer<Partial<Parameters<typeof set>[0]>>(300, set);

    try {
      const finish = await trajectoryArc({
        apiKey,
        model,
        messages: toLlmIR(historyCopy),
        config,
        transport,
        abortSignal: abortController.signal,
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

          onQuotaUpdated: quota => set({ quotaData: quota }),

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
        get().notifyReadyForInput(config);
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
          toolReqs: finishReason.toolCalls,
          runningToolCallId: null,
          abortController: new AbortController(),
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
      toolCall: toolReq,
    };
  }
  if (e instanceof FileOutdatedError) {
    const absolutePath = path.resolve(e.filePath);
    try {
      await fileTracker.readUntracked(transport, signal, absolutePath);
      return {
        type: "file-outdated",
        id: sequenceId(),
        toolCall: toolReq,
        error:
          "File could not be updated because it was modified after being last read. Please read the file again before modifying it.",
      };
    } catch {
      return {
        type: "file-unreadable",
        path: e.filePath,
        id: sequenceId(),
        toolCall: toolReq,
        error: `File ${e.filePath} could not be read. Has it been deleted?`,
      };
    }
  }
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
