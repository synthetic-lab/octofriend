import fs from "fs/promises";
import { Config, useConfig, getModelFromConfig } from "./config.ts";
import { run } from "./compilers/run.ts";
import { autofixEdit } from "./compilers/autofix.ts";
import { HistoryItem, UserItem, AssistantItem, ToolCallItem, sequenceId } from "./history.ts";
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
import { PaymentError, RateLimitError, errorToString, buildCurlCommandString } from "./errors.ts";
import { Transport } from "./transports/transport-common.ts";

export type RunArgs = {
  config: Config,
  transport: Transport,
};
export type UiState = {
  modeData: {
    mode: "input",
  } | {
    mode: "responding",
    inflightResponse: Omit<AssistantItem, "id" | "tokenUsage" | "outputTokens">,
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
    mode: "diff-apply",
    abortController: AbortController,
  } | {
    mode: "fix-json",
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
  setModelOverride: (m: string) => void,
  retryFrom: (mode: "payment-error" | "rate-limit-error" | "request-error", args: RunArgs) => Promise<void>,
  generateLatestCurlString: (args: RunArgs) => string,
  notify: (notif: string) => void,
  _runAgent: (args: RunArgs) => Promise<void>,
};

export const useAppStore = create<UiState>((set, get) => ({
  modeData: {
    mode: "input" as const,
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

  generateLatestCurlString: ({ config }) => {
    try {
      const history = [ ...get().history ];
      const messages = toLlmIR(history);
      const modelConfig = getModelFromConfig(config, get().modelOverride);

      return buildCurlCommandString({
        baseURL: modelConfig.baseUrl,
        model: modelConfig.model,
        messages,
      });
    } catch(err) {
      return "Failed to generate curl command";
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
      },
    });
  },

  abortResponse: () => {
    const { modeData } = get();
    if(
      modeData.mode === "responding" ||
      modeData.mode === "tool-waiting" ||
      modeData.mode === "diff-apply"
    ) {
      modeData.abortController.abort();
    }
  },

  toggleMenu: () => {
    const { modeData } = get();
    if(modeData.mode === "input") {
      set({
        modeData: { mode: "menu" },
      });
    } else if(modeData.mode === "menu") {
      set({
        modeData: { mode: "input" },
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

    if(abortController.signal.aborted) {
      set({
        modeData: { mode: "input" },
      });
    }
    else {
      await get()._runAgent({ config, transport });
    }
  },

  _runAgent: async ({ config, transport }) => {
    let content = "";
    let reasoningContent: undefined | string = undefined;

    const abortController = new AbortController();
    set({
      modeData: {
        mode: "responding",
        inflightResponse: {
          type: "assistant",
          content,
        },
        abortController,
      }
    });

    const debounceTimeout = 100;
    let timeout: NodeJS.Timeout | null = null;
    let lastContent = "";
    let byteCount = get().byteCount;

    const history = [ ...get().history ];
    try {
      const newMessages = await run({
        config, transport,
        modelOverride: get().modelOverride,
        messages: toLlmIR(history),
        abortSignal: abortController.signal,
        onTokens: (tokens, type) => {
          byteCount += tokens.length;

          if(type === "content") {
            content += tokens;

            // Skip duplicate updates
            if (content === lastContent) return;
            lastContent = content;
          } else if(type === "reasoning") {
            if(reasoningContent == null) reasoningContent = "";
            reasoningContent += tokens;
          }
          if (timeout) return;

          timeout = setTimeout(() => {
            set({
              modeData: {
                mode: "responding",
                inflightResponse: {
                  type: "assistant",
                  content, reasoningContent,
                },
                abortController,
              },
              byteCount,
            });
            timeout = null;
          }, debounceTimeout);
        },
        onAutofixJson: () => {
          set({ modeData: { mode: "fix-json" } });
        },
      });
      if(timeout) clearTimeout(timeout);
      history.push(...outputToHistory(newMessages));
    } catch(e) {
      if(abortController.signal.aborted) {
        // Handle abort gracefully - return to input mode
        set({
          modeData: {
            mode: "input",
          },
        });
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
      // Generate cURL Command as a string for user to copy
      const curlCommand = get().generateLatestCurlString({ config, transport });
      set({
        modeData: {
          mode: "request-error",
          error: errorToString(e),
          curlCommand,
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
    } finally {
      set({ byteCount: 0 });
    }

    const lastHistoryItem = history[history.length - 1];
    if(lastHistoryItem.type === "assistant") {
      set({ modeData: { mode: "input" }, history });
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
      await validateTool(abortController.signal, transport, lastHistoryItem.tool.function, config);
    } catch(e) {
      const fn = lastHistoryItem.tool.function;
      let fixed = false;
      if(fn.name === "edit") {
        set({
          modeData: {
            mode: "diff-apply",
            abortController,
          },
        });
        const path = fn.arguments.filePath;
        try {
          const file = await fs.readFile(path, "utf8");
          const fix = await autofixEdit(config, file, fn.arguments, abortController.signal);
          if (abortController.signal.aborted) {
            set({ modeData: { mode: "input" } });
            return;
          }
          if(fix) {
            // Validate that the edit applies before marking as fixed
            await validateTool(abortController.signal, transport, {
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
            await tryTransformToolError(abortController.signal, transport, lastHistoryItem, e),
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
