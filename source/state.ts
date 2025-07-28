import fs from "fs/promises";
import { Config, useConfig, getModelFromConfig } from "./config.ts";
import OpenAI from "openai";
import { runAgent, autofixEdit } from "./llm.ts";
import { HistoryItem, UserItem, AssistantItem, ToolCallItem, sequenceId } from "./history.ts";
import {
  runTool,
  validateTool,
  ToolError,
} from "./tools/index.ts";
import { create } from "zustand";
import { FileOutdatedError, fileTracker } from "./tools/file-tracker.ts";
import * as path from "path";
import { sleep } from "./sleep.ts";
import { useShallow } from "zustand/shallow";

export type RunArgs = {
  client: OpenAI,
  config: Config,
};
export type UiState = {
  modeData: {
    mode: "input",
  } | {
    mode: "responding",
    inflightResponse: Omit<AssistantItem, "id" | "tokenUsage">,
    abortController: AbortController,
  } | {
    mode: "tool-request",
    toolReq: ToolCallItem,
  } | {
    mode: "error-recovery",
  } | {
    mode: "diff-apply",
  } | {
    mode: "menu",
  } | {
    mode: "tool-waiting",
  },
  modelOverride: string | null,
  history: Array<HistoryItem>,
  input: (args: RunArgs & { query: string }) => Promise<void>,
  runTool: (args: RunArgs & { toolReq: ToolCallItem }) => Promise<void>,
  rejectTool: (toolCallId: string) => void,
  abortResponse: () => void,
  toggleMenu: () => void,
  setModelOverride: (m: string) => void,
  notify: (notif: string) => void,
  _runAgent: (args: RunArgs) => Promise<void>,
};

export const useAppStore = create<UiState>((set, get) => ({
  modeData: {
    mode: "input" as const,
  },
  history: [],
  modelOverride: null,

  input: async ({ client, config, query }) => {
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
    await get()._runAgent({ client, config });
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
    if (modeData.mode === "responding") {
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

  runTool: async ({ client, config, toolReq }) => {
    const modelOverride = get().modelOverride;
    set({ modeData: { mode: "tool-waiting" } });

    try {
      const content = await runTool({
        id: toolReq.id,
        tool: toolReq.tool.function,
      }, config, modelOverride);

      const toolHistoryItem: HistoryItem = {
        type: "tool-output",
        id: sequenceId(),
        content,
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
        await tryTransformToolError(toolReq, e),
      ];
      set({ history });
    }

    await get()._runAgent({ client, config });
  },

  _runAgent: async ({ client, config }) => {
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

    let history: HistoryItem[];
    try {
      history = await runAgent(
        client,
        config,
        get().modelOverride,
        get().history,
        (tokens, type) => {
          if(type === "content") {
            content += tokens;

            // Skip duplicate updates
            if (content === lastContent) return;
            lastContent = content;

            if (timeout) return;
          } else {
            if(reasoningContent == null) reasoningContent = "";
            reasoningContent += tokens;
            if(timeout) return;
          }

          // Schedule the UI update
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
            });

            timeout = null;
          }, debounceTimeout);
        },
        abortController.signal
      );
      if(timeout) clearTimeout(timeout);
    } catch(e) {
      if (abortController.signal.aborted) {
        // Handle abort gracefully - return to input mode
        set({
          modeData: {
            mode: "input",
          },
        });
        return;
      }

      console.error(e);
      set({
        history: [
          ...get().history,
          {
            type: "request-failed",
            id: sequenceId(),
          },
        ],
      });
      await sleep(1000);
      return get()._runAgent({ config, client });
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
      return get()._runAgent({ client, config });
    }

    if(lastHistoryItem.type !== "tool") {
      throw new Error(`Unexpected role: ${lastHistoryItem.type}`);
    }

    try {
      await validateTool(lastHistoryItem.tool.function, config);
    } catch(e) {
      const fn = lastHistoryItem.tool.function;
      let fixed = false;
      if(fn.name === "edit" && fn.arguments.edit.type === "diff") {
        set({
          modeData: {
            mode: "diff-apply",
          },
        });
        const path = fn.arguments.filePath;
        const file = await fs.readFile(path, "utf8");
        const fix = await autofixEdit(config, file, fn.arguments.edit);
        if(fix) {
          fixed = true;
          fn.arguments.edit = fix;
        }
      }

      if(!fixed) {
        set({
          modeData: {
            mode: "error-recovery",
          },
          history: [
            ...history,
            await tryTransformToolError(lastHistoryItem, e),
          ],
        });
        return await get()._runAgent({ client, config });
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
  toolReq: ToolCallItem, e: unknown
): Promise<HistoryItem> {
  if(e instanceof ToolError) {
    return {
      type: "tool-failed",
      id: sequenceId(),
      error: e.message,
      toolCallId: toolReq.tool.toolCallId,
    };
  }
  if(e instanceof FileOutdatedError) {
    const absolutePath = path.resolve(e.filePath);
    // Actually perform the read to ensure it's readable
    try {
      await fileTracker.read(absolutePath);
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
