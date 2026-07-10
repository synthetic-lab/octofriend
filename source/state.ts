import {
  AuthError,
  Config,
  useConfig,
  getModelFromConfig,
  readAuthForModel,
  runNotifyCommand,
} from "./config.ts";
import { ImageInfo } from "./utils/image-utils.ts";
import {
  createSession,
  HistoryNode,
  insertHistoryItems,
  HistoryItem,
  Session,
} from "./session-history/index.ts";
import type { ParsedCliArgs } from "./cli/cli-args.ts";
import { runTool } from "./tools/index.ts";
import type { ToolRunResult } from "./tools/index.ts";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { toLlmIR, outputToHistory } from "./ir/convert-history-ir.ts";
import { Transport } from "./transports/transport-common.ts";
import { trajectoryArc } from "./agent/trajectory-arc.ts";
import type { ModelData } from "./compilers/run.ts";
import type { ToolCall } from "./libocto/tool-def.ts";
import type toolMap from "./tools/tool-defs/index.ts";
import { QuotaData } from "./utils/quota.ts";
import { throttledBuffer } from "./throttled-buffer.ts";
import { loadTools } from "./tools/index.ts";
import type { OctoIR } from "./ir/octo-ir.ts";

export type RunArgs = {
  config: Config;
  transport: Transport;
};

type ToolCallRequest = ToolCall<typeof toolMap>;

export type InflightResponseType = {
  type: "inflight-response";
  content: string;
  reasoningContent?: string | null;
};
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
        mode: "tool-call";
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
        mode: "auth-error";
        model: Config["models"][number];
        error: AuthError;
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
  readonly history: readonly HistoryNode[];
  clearNonce: number;
  lastUserPromptIndex: number | null;
  _session: Session | null;
  getSession: () => Session;
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
  clearAuthError: () => void;
  editAndRetryFrom: (mode: "request-error" | "compaction-error", args: RunArgs) => void;
  notify: (notif: string) => void;
  addToWhitelist: (whitelistKey: string) => Promise<void>;
  isWhitelisted: (whitelistKey: string) => Promise<boolean>;
  hydrateSession: (session: Session, history: readonly HistoryNode[]) => void;
  startNewSession: (cwd: string, cliArgs: ParsedCliArgs) => void;
  _maybeHandleAbort: (signal: AbortSignal) => boolean;
  runAgent: (args: RunArgs) => Promise<void>;
};

function appendAndPersistHistory(
  session: Session,
  prevHistory: readonly HistoryNode[],
  itemsToInsert: HistoryItem[],
): HistoryNode[] {
  if (useAppStore.getState().getSession() !== session) {
    throw new Error(
      `Stale session detected. To recover, quit & resume with \`octo --resume ${session.metadata.sessionId ?? "<session-id>"}\``,
    );
  }
  const parentNodeId = prevHistory.at(-1)?.nodeId ?? null;
  return [...prevHistory, ...insertHistoryItems(session, parentNodeId, itemsToInsert)];
}

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
  lastUserPromptIndex: null,
  _session: null,
  getSession: () => {
    const session = get()._session;
    if (session == null) throw new Error("Session is not initialized.");
    return session;
  },
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
    const userMessage: HistoryItem = {
      type: "llm-ir",
      ir: {
        role: "user",
        content: [
          { type: "text", content: query },
          ...(images ?? []).map(image => ({ type: "image" as const, image })),
        ],
      },
    };

    const history = appendAndPersistHistory(get().getSession(), get().history, [userMessage]);
    set({ history, lastUserPromptIndex: history.length - 1 });
    await get().runAgent({ config, transport });
  },

  retryFrom: async (mode, args) => {
    if (get().modeData.mode === mode) {
      await get().runAgent(args);
    }
  },

  clearAuthError: () => {
    if (get().modeData.mode !== "auth-error") return;
    set({ modeData: { mode: "input", vimMode: "INSERT" } });
  },

  editAndRetryFrom: (mode, _args) => {
    if (get().modeData.mode !== mode) {
      return;
    }

    const { history, lastUserPromptIndex } = get();

    if (lastUserPromptIndex === null) {
      set({
        query: "",
        byteCount: 0,
        modeData: { mode: "input", vimMode: "INSERT" },
      });
      return;
    }

    const lastUserItem = history[lastUserPromptIndex];
    if (!lastUserItem || lastUserItem.type !== "llm-ir" || lastUserItem.ir.role !== "user") {
      set({
        query: "",
        byteCount: 0,
        modeData: { mode: "input", vimMode: "INSERT" },
      });
      return;
    }

    const filteredHistory = history.slice(0, lastUserPromptIndex);
    const textPart = lastUserItem.ir.content.find(part => part.type === "text");
    set(state => ({
      history: filteredHistory,
      query: textPart?.content ?? "",
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
      if (item.type === "llm-ir" && item.ir.role === "assistant" && item.ir.toolCalls) break;
    }
    const skippedCalls: HistoryItem[] = [];

    if (lastToolCallIndex >= 0) {
      const originatingToolCalls = history[lastToolCallIndex];
      const toolCalls =
        originatingToolCalls.type === "llm-ir" && originatingToolCalls.ir.role === "assistant"
          ? (originatingToolCalls.ir.toolCalls ?? [])
          : [];
      for (let toolCallIndex = 0; toolCallIndex < toolCalls.length; toolCallIndex++) {
        const call = toolCalls[toolCallIndex];
        if (call.toolCallId === toolCall.toolCallId && call.type === "tool-call") {
          for (const skippedCall of toolCalls.slice(toolCallIndex + 1)) {
            if (skippedCall.type === "tool-call") {
              skippedCalls.push({
                type: "llm-ir",
                ir: {
                  role: "tool-skip-output",
                  toolCall: skippedCall,
                  reason: "A previous tool call was rejected, so this tool was skipped",
                },
              });
            }
          }
          break;
        }
      }
    }
    set({
      history: appendAndPersistHistory(get().getSession(), get().history, [
        {
          type: "llm-ir",
          ir: {
            role: "tool-reject",
            toolCall,
          },
        },
        ...skippedCalls,
      ]),
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
      history: appendAndPersistHistory(get().getSession(), get().history, [
        {
          type: "notification",
          content: `Model: ${model}`,
        },
      ]),
    });
  },

  notify: notif => {
    set({
      history: appendAndPersistHistory(get().getSession(), get().history, [
        {
          type: "notification",
          content: notif,
        },
      ]),
    });
  },

  hydrateSession: (session, history) => {
    set(state => ({
      _session: session,
      history,
      lastUserPromptIndex: null,
      byteCount: 0,
      clearNonce: state.clearNonce + 1,
      sessionAutoNotify: false,
    }));
  },

  startNewSession: (cwd, cliArgs) => {
    // Abort any ongoing responses to avoid polluting the new cleared state.
    const { abortResponse } = get();
    abortResponse();

    set(state => ({
      history: [],
      lastUserPromptIndex: null,
      byteCount: 0,
      clearNonce: state.clearNonce + 1,
      sessionAutoNotify: false,
      _session: createSession(cwd, cliArgs),
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
    const session = get().getSession();
    if (modeData.mode !== "tool-call") {
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

    const tools = await loadTools(transport, abortController.signal, config);

    const result = await runTool(abortController.signal, transport, tools, toolReq, config);
    if (!result.success) {
      set({
        history: appendAndPersistHistory(session, get().history, [
          {
            type: "llm-ir",
            ir: {
              role: "tool-runtime-error",
              error: result.error,
              toolCall: toolReq,
            },
          },
        ]),
      });
    } else {
      set({
        history: appendAndPersistHistory(session, get().history, [
          {
            type: "llm-ir",
            ir: toolRunResultToIR(result.data, toolReq),
          },
        ]),
      });
    }

    if (get()._maybeHandleAbort(abortController.signal)) {
      return;
    }

    ({ modeData } = get());
    if (modeData.mode === "tool-call") {
      set({ modeData: { ...modeData, runningToolCallId: null } });
    }
  },

  runAgent: async ({ config, transport }) => {
    const historyCopy = [...get().history];
    const session = get().getSession();
    const abortController = new AbortController();
    let compactionByteCount = 0;
    let responseByteCount = 0;
    const model = getModelFromConfig(config, get().modelOverride);
    let modelData: ModelData;
    if (model.type === "codex") {
      const authResult = await readAuthForModel(model, config);
      if (!authResult.ok) {
        set({
          modeData: {
            mode: "auth-error",
            model,
            error: authResult.error,
          },
        });
        return;
      }
      modelData = { type: "codex", auth: authResult.auth, model };
    } else {
      const authResult = await readAuthForModel(model, config);
      if (!authResult.ok) {
        set({
          modeData: {
            mode: "auth-error",
            model,
            error: authResult.error,
          },
        });
        return;
      }
      modelData = { type: "api", auth: authResult.auth, model };
    }

    const throttle = throttledBuffer<Partial<Parameters<typeof set>[0]>>(300, set);

    try {
      const finish = await trajectoryArc({
        modelData,
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
                  type: "inflight-response",
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
                  type: "inflight-response",
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
                  type: "inflight-response",
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
                  type: "inflight-response",
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
            const checkpointItem: HistoryItem = {
              type: "llm-ir",
              ir: event.checkpoint,
            };
            set({ history: appendAndPersistHistory(session, historyCopy, [checkpointItem]) });
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
            set({
              history: appendAndPersistHistory(session, historyCopy, outputToHistory(event.irs)),
            });
          },
        },
      });
      throttle.flush();
      set({
        history: appendAndPersistHistory(session, historyCopy, outputToHistory(finish.irs)),
      });
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

      if (finishReason.type === "payment-error") {
        set({ modeData: { mode: "payment-error", error: finishReason.requestError } });
        return;
      }

      if (finishReason.type === "rate-limit-error") {
        set({ modeData: { mode: "rate-limit-error", error: finishReason.requestError } });
        return;
      }

      if (finishReason.type === "auth-error") {
        set({
          modeData: {
            mode: "auth-error",
            model,
            error: { type: "invalid", message: finishReason.authError },
          },
        });
        return;
      }

      if (finishReason.type === "compaction-error") {
        set({
          modeData: {
            mode: "compaction-error",
            error: finishReason.requestError,
            curlCommand: finishReason.curl,
          },
          history: appendAndPersistHistory(session, get().history, [
            {
              type: "compaction-failed",
            },
          ]),
        });
        return;
      }

      set({
        modeData: {
          mode: "tool-call",
          toolReqs: finishReason.toolCalls,
          runningToolCallId: null,
          abortController: new AbortController(),
        },
      });
    } catch (e) {
      if (get()._maybeHandleAbort(abortController.signal)) {
        return;
      }

      throw e;
    } finally {
      set({ byteCount: 0 });
    }
  },
}));

function toolRunResultToIR(result: ToolRunResult, toolCall: ToolCallRequest): OctoIR {
  if (result.type === "custom-ir") {
    return result.data;
  }

  if (result.type === "invoke-subagent") {
    throw new Error(`Subagent invocation is not supported in Octo tools: ${result.name}`);
  }

  return {
    role: "tool-output",
    toolCall,
    content: result.content,
  };
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
