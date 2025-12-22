import fs from "fs/promises";
import { Config, useConfig, getModelFromConfig } from "./config.ts";
import { run } from "./compilers/run.ts";
import { generateCompactionSummary, shouldAutoCompactHistory } from "./compilers/autocompact.ts";
import { autofixEdit } from "./compilers/autofix.ts";
import { HistoryItem, UserItem, AssistantItem, ToolCallItem, CompactionCheckpointItem, CompactionFailed, sequenceId } from "./history.ts";
import {
  runTool,
  validateTool,
  ToolError,
} from "./tools/index.ts";
import { create } from "zustand";
import { FileOutdatedError, fileTracker } from "./tools/file-tracker.ts";
import * as path from "path";
import { useShallow } from "zustand/shallow";
import { toLlmIR, outputToHistory } from "./ir/llm-ir.ts";
import * as logger from "./logger.ts";
import { PaymentError, RateLimitError, CompactionRequestError } from "./errors.ts";
import { Transport } from "./transports/transport-common.ts";

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
    toolReq: ToolCallItem,
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
  runTool: (args: RunArgs & { toolReq: ToolCallItem }) => Promise<void>,
  rejectTool: (toolCallId: string) => void,
  abortResponse: () => void,
  toggleMenu: () => void,
  setVimMode: (vimMode: "INSERT" | "NORMAL") => void,
  setModelOverride: (m: string) => void,
  retryFrom: (mode: "payment-error" | "rate-limit-error" | "request-error" | "compaction-error", args: RunArgs) => Promise<void>,
  notify: (notif: string) => void,
  _maybeHandleAbort: (signal: AbortSignal) => boolean,
  _maybeHandleAutocompaction: (args: {
    messages: ReturnType<typeof toLlmIR>;
    config: Config;
    transport: Transport;
    historyCopy: HistoryItem[];
    onAutofixJson: () => void;
    abortController: AbortController;
  }) => Promise<void>,
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
    if(
      modeData.mode === "responding" ||
      modeData.mode === "tool-waiting" ||
      modeData.mode === "diff-apply" ||
      modeData.mode === "compacting"
    ) {
      modeData.abortController.abort();
    }
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
      const result = await runTool(abortController.signal, transport, {
        id: toolReq.id,
        tool: toolReq.tool.function,
      }, config, modelOverride);

      const toolHistoryItem: HistoryItem = {
        type: "tool-output",
        id: sequenceId(),
        result,
        toolCallId: toolReq.tool.toolCallId,
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

  // appends a compaction-checkpoint message to history when eligible
  _maybeHandleAutocompaction: async ({ messages, config, transport, historyCopy, onAutofixJson, abortController }) => {
    if (!shouldAutoCompactHistory(messages, config, get().modelOverride, config.autoCompact)) {
      return;
    }

    let compactionByteCount = 0;
    let compactionContent = "";
    let lastCompactionContent = "";
    const compactionUpdater = createDebouncedUpdater();

    try {
      const checkpointSummary = await generateCompactionSummary(
        messages,
        config,
        transport,
        get().modelOverride,
        (tokens, type) => {
          compactionByteCount += tokens.length;
          if (type === "content") {
            compactionContent += tokens;
            if (compactionContent === lastCompactionContent) return;
            lastCompactionContent = compactionContent;
          }

          compactionUpdater.schedule(() => {
            set({
              modeData: {
                mode: "compacting",
                inflightResponse: {
                  type: "assistant",
                  content: compactionContent,
                },
                abortController,
              },
              byteCount: compactionByteCount,
            });
          });
        },
        onAutofixJson,
        abortController.signal
      );

      compactionUpdater.clear();

      if (get()._maybeHandleAbort(abortController.signal)) {
        return;
      }

      if (checkpointSummary) {
        const checkpointItem: CompactionCheckpointItem = {
          type: "compaction-checkpoint",
          id: sequenceId(),
          summary: checkpointSummary,
        };
        historyCopy.push(checkpointItem);
        set({ history: historyCopy });
      }
    } catch (e) {
      compactionUpdater.clear();
      if (get()._maybeHandleAbort(abortController.signal)) {
        return;
      }
      throw e;
    }
  },

  _runAgent: async ({ config, transport }) => {
    const historyCopy = [ ...get().history ];
    const messages = toLlmIR(historyCopy);
    const onAutofixJson = () => { set({ modeData: { mode: "fix-json" } }); };

    const compactionAbortController = new AbortController();

    try {
      await get()._maybeHandleAutocompaction({
        messages,
        config,
        transport,
        historyCopy,
        onAutofixJson,
        abortController: compactionAbortController,
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
      const errorMessage = e instanceof Error ? e.message : String(e);
      set({
        modeData: {
          mode: "compaction-error",
          error: errorMessage,
          curlCommand: null,
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
    } finally {
      set({ byteCount: 0 });
    }

    if (get()._maybeHandleAbort(compactionAbortController.signal)) {
      return;
    }

    const agentAbortController = new AbortController();

    let content = "";
    let reasoningContent: undefined | string = undefined;
    let byteCount = get().byteCount;
    let lastContent = "";
    const agentUpdater = createDebouncedUpdater();

    set({
      modeData: {
        mode: "responding",
        inflightResponse: {
          type: "assistant",
          content,
        },
        abortController: agentAbortController,
      }
    });

    const history = [ ...get().history ];
    try {
      const result = await run({
        config, transport,
        modelOverride: get().modelOverride,
        messages: toLlmIR(history),
        abortSignal: agentAbortController.signal,
        onTokens: (tokens, type) => {
          byteCount += tokens.length;

          if(type === "content") {
            content += tokens;
            if(content === lastContent) return;
            lastContent = content;
          } else if(type === "reasoning") {
            if(reasoningContent == null) reasoningContent = "";
            reasoningContent += tokens;
          }

          agentUpdater.schedule(() => {
            set({
              modeData: {
                mode: "responding",
                inflightResponse: {
                  type: "assistant",
                  content,
                  reasoningContent,
                },
                abortController: agentAbortController,
              },
              byteCount,
            });
          });
        },
        onAutofixJson,
      });

      agentUpdater.clear();

      // Successful result has an output with the OutputIR
      // Failed result has the requestError and associated curl
      if (result.success) {
        history.push(...outputToHistory(result.output));
      } else {
        set({
          modeData: {
            mode: "request-error",
            error: result.requestError,
            curlCommand: result.curl,
          },
          history: [
            ...get().history,
            {
              type: "request-failed",
              id: sequenceId(),
            },
          ],
        });
        return;
      }
    } catch(e) {
      if(get()._maybeHandleAbort(agentAbortController.signal)) {
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
      return;
    } finally {
      set({ byteCount: 0 });
    }

    const lastHistoryItem = history[history.length - 1];
    if(lastHistoryItem.type === "assistant") {
      set({ modeData: { mode: "input", vimMode: "NORMAL" }, history });
      return;
    }
    if(lastHistoryItem.type === "tool-failed" || lastHistoryItem.type === "tool-malformed") {
      set({
        modeData: { mode: "error-recovery" },
        history
      });
      return get()._runAgent({ config, transport });
    }

    if(lastHistoryItem.type !== "tool") {
      throw new Error(`Unexpected role: ${lastHistoryItem.type}`);
    }

    try {
      await validateTool(agentAbortController.signal, transport, lastHistoryItem.tool.function, config);
    } catch(e) {
      const fn = lastHistoryItem.tool.function;
      let fixed = false;
      if(fn.name === "edit") {
        set({
          modeData: {
            mode: "diff-apply",
            abortController: agentAbortController,
          },
        });
        const path = fn.arguments.filePath;
        try {
          const file = await fs.readFile(path, "utf8");
          const fix = await autofixEdit(config, file, fn.arguments, agentAbortController.signal);
          if (get()._maybeHandleAbort(agentAbortController.signal)) {
            return;
          }
          if(fix) {
            // Validate that the edit applies before marking as fixed
            await validateTool(agentAbortController.signal, transport, {
              name: "edit",
              arguments: fix,
            }, config);
            fixed = true;
            fn.arguments = {
              ...fn.arguments,
              ...fix,
            };
          }
        } catch {}
      }

      if(!fixed) {
        set({
          modeData: {
            mode: "error-recovery",
          },
          history: [
            ...history,
            await tryTransformToolError(agentAbortController.signal, transport, lastHistoryItem, e),
          ],
        });
        return await get()._runAgent({ config, transport });
      }
    }

    set({
      modeData: {
        mode: "tool-request",
        toolReq: lastHistoryItem,
      },
      history,
    });
  },
}));

async function tryTransformToolError(
  signal: AbortSignal,
  transport: Transport,
  toolReq: ToolCallItem,
  e: unknown,
): Promise<HistoryItem> {
  if(e instanceof ToolError) {
    return {
      type: "tool-failed",
      id: sequenceId(),
      error: e.message,
      toolCallId: toolReq.tool.toolCallId,
      toolName: toolReq.tool.function.name,
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
        toolCallId: toolReq.tool.toolCallId,
      };
    } catch {
      return {
        type: "file-unreadable",
        path: e.filePath,
        id: sequenceId(),
        toolCallId: toolReq.tool.toolCallId,
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
