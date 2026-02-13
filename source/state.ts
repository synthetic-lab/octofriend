import { Config, useConfig, getModelFromConfig, assertKeyForModel } from "./config.ts";
import {
  HistoryItem,
  UserItem,
  AssistantItem,
  CompactionCheckpointItem,
  sequenceId,
} from "./history.ts";
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
import { throttledBuffer } from "./throttled-buffer.ts";
import { loadTools } from "./tools/index.ts";

export type RunArgs = {
  config: Config;
  transport: Transport;
};

export type InflightResponseType = Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens">;
export type UiState = {
  preMenuVimMode: "NORMAL" | "INSERT" | null;
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
  lastUserPromptId: bigint | null;
  input: (args: RunArgs & { query: string }) => Promise<void>;
  runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>;
  rejectTool: (toolCallId: string) => void;
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
  _maybeHandleAbort: (signal: AbortSignal) => boolean;
  _runAgent: (args: RunArgs) => Promise<void>;
  clearHistory: () => void;
};

export const useAppStore = create<UiState>((set, get) => ({
  preMenuVimMode: null,
  modeData: {
    mode: "input" as const,
    vimMode: "INSERT" as const,
  },
  history: [],
  modelOverride: null,
  byteCount: 0,
  query: "",
  clearNonce: 0,
  lastUserPromptId: null,

  input: async ({ config, query, transport }) => {
    const userMessage: UserItem = {
      type: "user",
      id: sequenceId(),
      content: query,
    };

    let history = [...get().history, userMessage];
    set({ history, lastUserPromptId: userMessage.id });
    await get()._runAgent({ config, transport });
  },

  retryFrom: async (mode, args) => {
    if (get().modeData.mode === mode) {
      await get()._runAgent(args);
    }
  },

  editAndRetryFrom: (mode, _args) => {
    if (get().modeData.mode !== mode) {
      return;
    }

    const { history, lastUserPromptId, byteCount } = get();

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
        preMenuVimMode: modeData.vimMode,
      });
    } else if (modeData.mode === "menu") {
      const { preMenuVimMode } = get();
      set({
        modeData: { mode: "input", vimMode: preMenuVimMode ?? "INSERT" },
        preMenuVimMode: null,
      });
    }
  },
  closeMenu: () => {
    const { preMenuVimMode } = get();
    set({
      modeData: { mode: "input", vimMode: preMenuVimMode ?? "INSERT" },
      preMenuVimMode: null,
    });
  },
  openMenu: () => {
    const { modeData } = get();
    const currentVimMode = modeData.mode === "input" ? modeData.vimMode : "INSERT";
    set({
      modeData: { mode: "menu" },
      preMenuVimMode: currentVimMode,
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
    set({ preMenuVimMode: "INSERT" });
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

  runTool: async ({ config, toolReq, transport }) => {
    const modelOverride = get().modelOverride;
    const abortController = new AbortController();
    set({
      modeData: {
        mode: "tool-waiting",
        abortController,
      },
    });

    const tools = await loadTools(transport, abortController.signal, config);
    try {
      const result = await runTool(
        abortController.signal,
        transport,
        tools,
        toolReq.function,
        config,
        modelOverride,
      );

      const toolHistoryItem: HistoryItem = {
        type: "tool-output",
        id: sequenceId(),
        result,
        toolCallId: toolReq.toolCallId,
      };

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

    const throttle = throttledBuffer<Partial<Parameters<typeof set>[0]>>(200, set);

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
    } catch {
      return {
        type: "file-unreadable",
        path: e.filePath,
        id: sequenceId(),
        toolCallId: toolReq.toolCallId,
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
