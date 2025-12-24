import { Config, useConfig, getModelFromConfig } from "./config.ts";
import {
  HistoryItem, UserItem, AssistantItem, CompactionCheckpointItem, sequenceId
} from "./history.ts";
import {
  runTool,
  ToolError,
} from "./tools/index.ts";
import { create } from "zustand";
import { FileOutdatedError, fileTracker } from "./tools/file-tracker.ts";
import * as path from "path";
import { useShallow } from "zustand/shallow";
import { toLlmIR, outputToHistory } from "./ir/convert-history-ir.ts";
import * as logger from "./logger.ts";
import { PaymentError, RateLimitError, CompactionRequestError } from "./errors.ts";
import { Transport } from "./transports/transport-common.ts";
import { trajectoryArc, trajectoryEventHandler } from "./agent/trajectory-arc.ts";
import { ToolCallRequest } from "./ir/llm-ir.ts";

export type RunArgs = {
  config: Config,
  transport: Transport,
};

type DebouncedUpdater = {
  schedule: (updateFn: () => void) => void;
  clear: () => void;
};

function createDebouncedUpdater(debounceTimeout: number = 100): DebouncedUpdater {
  let timeout: NodeJS.Timeout | null = null;
  return {
    schedule: (updateFn: () => void) => {
      if (timeout) return;
      timeout = setTimeout(() => {
        updateFn();
        timeout = null;
      }, debounceTimeout);
    },
    clear: () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    },
  };
}

export type InflightResponseType = Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens">
export type UiState = {
  modeData: {
    mode: "input",
    vimMode: "NORMAL" | "INSERT",
  } | {
    mode: "responding",
    inflightResponse: InflightResponseType,
    abortController: AbortController,
  } | {
    mode: "tool-request",
    toolReq: ToolCallRequest,
  } | {
    mode: "error-recovery",
  } | {
    mode: "payment-error",
    error: string,
  } | {
    mode: "rate-limit-error",
    error: string,
  } | {
    mode: "request-error",
    error: string,
    curlCommand: string | null,
  } | {
    mode: "compaction-error",
    error: string,
    curlCommand: string | null,
  } | {
    mode: "diff-apply",
    abortController: AbortController,
  } | {
    mode: "fix-json",
    abortController: AbortController,
  } | {
    mode: "compacting",
    inflightResponse: InflightResponseType,
    abortController: AbortController,
  } | {
    mode: "menu",
  } | {
    mode: "tool-waiting",
    abortController: AbortController,
  },
  modelOverride: string | null,
  byteCount: number,
  history: Array<HistoryItem>,
  input: (args: RunArgs & { query: string }) => Promise<void>,
  runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>,
  rejectTool: (toolCallId: string) => void,
  abortResponse: () => void,
  toggleMenu: () => void,
  setVimMode: (vimMode: "INSERT" | "NORMAL") => void,
  setModelOverride: (m: string) => void,
  retryFrom: (mode: "payment-error" | "rate-limit-error" | "request-error" | "compaction-error", args: RunArgs) => Promise<void>,
  notify: (notif: string) => void,
  _maybeHandleAbort: (signal: AbortSignal) => boolean,
  _runAgent: (args: RunArgs) => Promise<void>,
};

export const useAppStore = create<UiState>((set, get) => ({
  modeData: {
    mode: "input" as const,
    vimMode: "NORMAL" as const,
  },
  history: [],
  modelOverride: null,
  byteCount: 0,

  input: async ({ config, query, transport }) => {
    const userMessage: UserItem = {
			type: "user",
      id: sequenceId(),
			content: query,
		};

		let history = [
			...get().history,
			userMessage,
		];
    set({ history });
    await get()._runAgent({ config, transport });
  },

  retryFrom: async (mode, args) => {
    if(get().modeData.mode === mode) {
      await get()._runAgent(args);
    }
  },

  rejectTool: (toolCallId) => {
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
        vimMode: "NORMAL",
      },
    });
  },

  abortResponse: () => {
    const { modeData } = get();
    if("abortController" in modeData) modeData.abortController.abort();
  },

  _maybeHandleAbort: (signal: AbortSignal): boolean => {
    if (signal.aborted) {
      set({
        modeData: {
          mode: "input",
          vimMode: "NORMAL",
        },
      });
      return true;
    }
    return false;
  },

  toggleMenu: () => {
    const { modeData } = get();
    if(modeData.mode === "input") {
      set({
        modeData: { mode: "menu" },
      });
    } else if(modeData.mode === "menu") {
      set({
        modeData: { mode: "input", vimMode: "NORMAL" },
      });
    }
  },

  setVimMode: (vimMode: "INSERT" | "NORMAL") => {
    const { modeData } = get();
    if(modeData.mode === "input") {
      set({
        modeData: { mode: "input", vimMode },
      });
    }
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

  runTool: async ({ config, toolReq, transport }) => {
    const modelOverride = get().modelOverride;
    const abortController = new AbortController();
    set({
      modeData: {
        mode: "tool-waiting",
        abortController,
      },
    });

    try {
      const result = await runTool(
        abortController.signal, transport, toolReq.function, config, modelOverride
      );

      const toolHistoryItem: HistoryItem = {
        type: "tool-output",
        id: sequenceId(),
        result,
        toolCallId: toolReq.toolCallId,
      };

      const history: HistoryItem[] = [
        ...get().history,
        toolHistoryItem,
      ];

      set({ history });
    } catch(e) {
      const history = [
        ...get().history,
        await tryTransformToolError(abortController.signal, transport, toolReq, e),
      ];
      set({ history });
    }

    if(get()._maybeHandleAbort(abortController.signal)) {
      return;
    }
    await get()._runAgent({ config, transport });
  },

  _runAgent: async ({ config, transport }) => {
    const historyCopy = [ ...get().history ];
    const abortController = new AbortController();
    let compactionByteCount = 0;
    let responseByteCount = 0;
    const trajectoryHandler = trajectoryEventHandler({
      startResponse: () => {
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
        set({
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
        set({
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
        const checkpointItem: CompactionCheckpointItem = {
          type: "compaction-checkpoint",
          id: sequenceId(),
          summary: event.checkpoint.summary,
        };
        historyCopy.push(checkpointItem);
        set({ history: [ ...historyCopy ] });
      },

      autofixingJson: () => {
        set({
          modeData: {
            mode: "fix-json",
            abortController,
          },
        });
      },

      autofixingDiff: () => {
        set({
          modeData: {
            mode: "diff-apply",
            abortController,
          }
        });
      },

      retryTool: event => {
        historyCopy.push(...outputToHistory(event.irs));
        set({ history: [ ...historyCopy ] });
      },
    });
    try {
      const generator = trajectoryArc({
        messages: toLlmIR(historyCopy),
        config, transport,
        modelOverride: get().modelOverride,
        abortSignal: abortController.signal,
      });
      let result = await generator.next();
      while(!result.done) {
        trajectoryHandler(result.value);
        result = await generator.next();
      }
      const finish = result.value;
      historyCopy.push(...outputToHistory(finish.irs));
      set({ history: [ ...historyCopy ] });
      const finishReason = finish.reason;
      if(finishReason.type === "abort" || finishReason.type === "needs-response") {
        set({ modeData: { mode: "input", vimMode: "INSERT" } });
        return;
      }

      set({
        modeData: {
          mode: "tool-request",
          toolReq: finishReason.toolCall,
        },
      });
    } catch(e) {
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
      if(get()._maybeHandleAbort(abortController.signal)) {
        return;
      }

      if(e instanceof PaymentError) {
        set({
          modeData: { mode: "payment-error", error: e.message },
        });
        return;
      }
      else if(e instanceof RateLimitError) {
        set({
          modeData: { mode: "rate-limit-error", error: e.message },
        });
        return;
      }

      logger.error("verbose", e);
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
  if(e instanceof ToolError) {
    return {
      type: "tool-failed",
      id: sequenceId(),
      error: e.message,
      toolCallId: toolReq.toolCallId,
      toolName: toolReq.function.name,
    };
  }
  if(e instanceof FileOutdatedError) {
    const absolutePath = path.resolve(e.filePath);
    // Actually perform the read to ensure it's readable
    try {
      await fileTracker.read(transport, signal, absolutePath);
      return {
        type: "file-outdated",
        id: sequenceId(),
        toolCallId: toolReq.toolCallId,
      };
    } catch {
      return {
        type: "file-unreadable",
        path: e.filePath,
        id: sequenceId(),
        toolCallId: toolReq.toolCallId,
      };
    }
  }
  throw e;
}

export function useModel() {
  const { modelOverride } = useAppStore(
    useShallow(state => ({
      modelOverride: state.modelOverride,
    }))
  );
  const config = useConfig();

  return getModelFromConfig(config, modelOverride);
}
