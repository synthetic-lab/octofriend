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
import { db, schema } from "./db/db.ts";
import { eq, desc, asc, inArray } from "drizzle-orm";

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
  currentSessionId: number | null;
  modelOverride: string | null;
  byteCount: number;
  query: string;
  history: Array<HistoryItem>;
  clearNonce: number;
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
  startNewSession: () => void;
  loadSession: (sessionId: number) => Promise<void>;
  listSessions: () => Promise<
    Array<{ id: number; name: string; lastActiveAt: Date; model: string }>
  >;
  wipeAllHistory: () => Promise<void>;
  _ensureSession: (config: Config) => Promise<number>;
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
  currentSessionId: null,

  input: async ({ config, query, transport }) => {
    const userMessage: UserItem = {
      type: "user",
      id: sequenceId(),
      content: query,
    };

    let history = [...get().history, userMessage];
    set({ history });

    const sessionId = await get()._ensureSession(config);
    if (sessionId != null) {
      await db()
        .insert(schema.messagesTable)
        .values({
          sessionId,
          sequenceId: Number(userMessage.id),
          data: serializeHistoryItem(userMessage),
          createdAt: new Date(),
        });
      await db()
        .update(schema.sessionsTable)
        .set({ lastActiveAt: new Date() })
        .where(eq(schema.sessionsTable.id, sessionId));

      // Update session name if it's the first user message
      if (history.filter(m => m.type === "user").length === 1) {
        await db()
          .update(schema.sessionsTable)
          .set({ name: query.slice(0, 50) })
          .where(eq(schema.sessionsTable.id, sessionId));
      }
    }

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

      const sessionId = await get()._ensureSession(config);
      if (sessionId != null) {
        await db()
          .insert(schema.messagesTable)
          .values({
            sessionId,
            sequenceId: Number(toolHistoryItem.id),
            data: serializeHistoryItem(toolHistoryItem),
            createdAt: new Date(),
          });
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
      const outputMessages = outputToHistory(finish.irs);
      historyCopy.push(...outputMessages);
      set({ history: [...historyCopy] });

      const sessionId = await get()._ensureSession(config);
      if (sessionId != null) {
        for (const msg of outputMessages) {
          await db()
            .insert(schema.messagesTable)
            .values({
              sessionId,
              sequenceId: Number(msg.id),
              data: serializeHistoryItem(msg),
              createdAt: new Date(),
            });
        }
        await db()
          .update(schema.sessionsTable)
          .set({ lastActiveAt: new Date() })
          .where(eq(schema.sessionsTable.id, sessionId));
      }

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

  clearHistory: () => {
    // Abort any ongoing responses to avoid polluting the new cleared state.
    const { abortResponse, history } = get();
    abortResponse();

    // Only update state if there's actually history to clear
    // This prevents unnecessary Static component remounts that cause duplicate intros
    if (history.length > 0) {
      // Clear screen before state update
      if (process.stdout.isTTY) {
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      }
      set(state => ({
        history: [],
        byteCount: 0,
        currentSessionId: null,
        clearNonce: state.clearNonce + 1,
      }));
    }
  },

  startNewSession: () => {
    get().clearHistory();
  },

  loadSession: async sessionId => {
    const messages = await db()
      .select()
      .from(schema.messagesTable)
      .where(eq(schema.messagesTable.sessionId, sessionId))
      .orderBy(schema.messagesTable.id);

    const history: HistoryItem[] = messages.map(m => deserializeHistoryItem(m.data));

    // Clear screen before state update
    if (process.stdout.isTTY) {
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
    }

    set({
      currentSessionId: sessionId,
      history,
      clearNonce: get().clearNonce + 1,
    });
  },

  listSessions: async () => {
    // Only return sessions that have at least one message
    const sessionsWithMessages = db()
      .select({ sessionId: schema.messagesTable.sessionId })
      .from(schema.messagesTable)
      .groupBy(schema.messagesTable.sessionId);

    return db()
      .select()
      .from(schema.sessionsTable)
      .where(inArray(schema.sessionsTable.id, sessionsWithMessages))
      .orderBy(desc(schema.sessionsTable.id));
  },

  wipeAllHistory: async () => {
    const { history } = get();
    await db().delete(schema.sessionsTable);
    // Messages will be deleted by cascade

    // Only update state if there's actually history to clear
    if (history.length > 0) {
      // Clear screen before state update
      if (process.stdout.isTTY) {
        process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      }
      set({
        currentSessionId: null,
        history: [],
        clearNonce: get().clearNonce + 1,
      });
    }
  },

  _ensureSession: async (config: Config) => {
    let sessionId = get().currentSessionId;
    if (sessionId == null) {
      const model = getModelFromConfig(config, get().modelOverride);
      const [newSession] = await db()
        .insert(schema.sessionsTable)
        .values({
          name: "New Session",
          lastActiveAt: new Date(),
          model: model.nickname,
        })
        .returning();
      sessionId = newSession.id;
      set({ currentSessionId: sessionId });
    }
    return sessionId;
  },
}));

function serializeHistoryItem(item: HistoryItem): string {
  return JSON.stringify(item, (k, v) => (typeof v === "bigint" ? v.toString() : v));
}

function deserializeHistoryItem(data: string): HistoryItem {
  return JSON.parse(data, (k, v) => (k === "id" && typeof v === "string" ? BigInt(v) : v));
}

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
