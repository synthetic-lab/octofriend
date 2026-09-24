import {
  AuthError,
  Config,
  ModelConfig,
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
  latestModelJson,
  HistoryItem,
  Session,
} from "./session-history/index.ts";
import { serializeModelJson } from "./session-history/model-json.ts";
import {
  assertToolCallPairing,
  repairOrphanedToolOutputs,
} from "./session-history/tool-pairing.ts";
import type { ParsedCliArgs } from "./cli/cli-args.ts";
import { runTool } from "./tools/index.ts";
import type { ToolRunResult } from "./tools/index.ts";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { toLlmIR } from "./ir/convert-history-ir.ts";
import { Transport } from "./transports/transport-common.ts";
import { trajectoryArc } from "./libocto/trajectory-arc.ts";
import { run, type ModelData } from "./compilers/run.ts";
import { lowerOcto, lowerOctoToLlmIR } from "./compilers/lower-octo.ts";
import { autofixEdit, makeAutofixJson } from "./compilers/autofix.ts";
import { systemPrompt } from "./prompts/system-prompt.ts";
import { answeredToolCallId } from "./libocto/llm-ir.ts";
import type { PermissionDecision, PermissionGate } from "./libocto/permissions.ts";
import { err, ok, type Result } from "./libocto/result.ts";
import {
  octoPermissionGate,
  whitelistKey,
  type OctoGateState,
  type OctoPermissionControl,
  type ToolCallRequest,
} from "./octo-permissions.ts";
import { parseQuotaJson, QuotaData } from "./utils/quota.ts";
import { throttledBuffer } from "./throttled-buffer.ts";
import { loadTools, SKIP_CONFIRMATION_TOOLS } from "./tools/index.ts";
import { octoAgent, type OctoIR } from "./ir/octo-ir.ts";

export const MAX_RETRY_COUNT = 20;

export type RunArgs = {
  config: Config;
  transport: Transport;
  session: Session;
};

export type QueuedUserMessage = {
  id: number;
  content: string;
  images?: ImageInfo[];
};

let nextQueuedMessageId = 1;

export function coalesceQueuedUserMessages(messages: readonly QueuedUserMessage[]): {
  query: string;
  images?: ImageInfo[];
} {
  const images = messages.flatMap(m => m.images ?? []);
  return {
    query: messages.map(m => m.content).join("\n"),
    ...(images.length > 0 ? { images } : {}),
  };
}

function userMessageItem(query: string, images?: ImageInfo[]): HistoryItem {
  return {
    type: "llm-ir",
    ir: {
      role: "user",
      content: [
        { type: "text", content: query },
        ...(images ?? []).map(image => ({ type: "image" as const, image })),
      ],
    },
  };
}

type PermissionSlice = OctoGateState & {
  unchained: boolean;
  pendingControl: OctoPermissionControl | null;
};

export type InflightResponseType = {
  type: "inflight-response";
  content: string;
  reasoningContent?: string | null;
};
export type UiState = {
  isMenuOpen: boolean;
  _notifyTimer: NodeJS.Timeout | null;
  sessionAutoNotify: boolean;
  notifyOnce: boolean;
  modeData:
    | {
        mode: "ready-for-request";
      }
    | {
        mode: "responding";
        inflightResponse: InflightResponseType;
        abortController: AbortController;
      }
    | {
        mode: "tool-call";
        toolReqs: ToolCallRequest[];
        abortController: AbortController;
      }
    | {
        mode: "tool-call-permission";
        toolReqs: ToolCallRequest[];
        abortController: AbortController;
      }
    | {
        mode: "awaiting-steering";
        toolReqs: ToolCallRequest[];
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
        mode: "request-error-retrying";
        error: string;
        attempt: number;
        delayMs: number;
        abortController: AbortController;
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
      };

  runningToolCallId: string | null;

  modelOverride: string | null;
  quotaData: QuotaData | null;
  byteCount: number;
  query: string;
  attachedImages: ImageInfo[];
  queuedUserMessages: readonly QueuedUserMessage[];
  readonly history: readonly HistoryNode[];
  clearNonce: number;
  sessionHydrationNonce: number;
  lastUserPromptIndex: number | null;
  permission: PermissionSlice;
  notifyReadyForInput: (config: Config) => void;
  cancelNotifyReadyForInput: () => void;
  setNotifyOnce: (notifyOnce: boolean) => void;
  setNotifySession: (notifySession: boolean) => void;
  input: (args: RunArgs & { query: string; images?: ImageInfo[] }) => Promise<void>;
  runTool: (args: RunArgs & { toolReq: ToolCallRequest }) => Promise<void>;
  _appendToolRejection: (toolCall: ToolCallRequest, args: RunArgs) => void;
  _appendUserSteering: (steering: string, args: RunArgs) => void;
  abortResponse: (session: Session, config: Config, opts?: { exiting?: boolean }) => void;
  toggleMenu: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  setModelOverride: (m: ModelConfig, session: Session) => void;
  setQuery: (query: string) => void;
  addAttachedImage: (image: ImageInfo) => void;
  removeLastAttachedImage: () => void;
  clearAttachedImages: () => void;
  enqueueUserMessage: (msg: Omit<QueuedUserMessage, "id">) => void;
  _appendQueuedUserMessages: (session: Session, config: Config) => void;
  retryFrom: (
    mode: "payment-error" | "rate-limit-error" | "request-error" | "compaction-error",
    args: RunArgs,
  ) => Promise<void>;
  clearAuthError: () => void;
  editAndRetryFrom: (mode: "request-error" | "compaction-error", args: RunArgs) => void;
  notify: (notif: string, session: Session, config: Config) => void;
  setUnchained: (unchained: boolean) => void;
  hydrateSession: (history: readonly HistoryNode[]) => void;
  startNewSession: (cwd: string, cliArgs: ParsedCliArgs) => Session;
  _maybeHandleAbort: (signal: AbortSignal) => boolean;
  runAgent: (args: RunArgs) => Promise<void>;
  _runAgentOnce: (args: RunArgs) => Promise<boolean>;
};

export function inputFieldAvailable(modeData: UiState["modeData"]): boolean {
  switch (modeData.mode) {
    case "tool-call-permission":
    case "error-recovery":
    case "payment-error":
    case "rate-limit-error":
    case "auth-error":
    case "request-error":
    case "compaction-error":
      return false;
    // DO NOT turn these cases into "default".
    // each new mode should consider whether the input field should be available
    case "ready-for-request":
    case "responding":
    case "compacting":
    case "diff-apply":
    case "fix-json":
    case "request-error-retrying":
    case "awaiting-steering":
    case "tool-call":
      return true;
  }
}

function appendAndPersistHistory(
  session: Session,
  prevHistory: readonly HistoryNode[],
  itemsToInsert: HistoryItem[],
  model: ModelConfig,
): HistoryNode[] {
  const parentNodeId = prevHistory.at(-1)?.nodeId ?? null;
  return [
    ...prevHistory,
    ...insertHistoryItems(session, parentNodeId, itemsToInsert, serializeModelJson(model)),
  ];
}

/*
 * Finds the index of the current batch's request message: the most recent assistant IR that
 * requested any of the batch's tool calls.
 *
 * Tool call IDs are only guaranteed unique within a single response — some providers recycle
 * IDs across turns (e.g. per-response counters like call_0), and provider-generated IDs must
 * never be rewritten. So "has this request been answered?" can only be asked relative to the
 * current batch: answers appended before this index belong to earlier batches that happen to
 * share IDs, and must not count.
 */
function batchRequestIndex(history: readonly HistoryNode[], toolReqs: ToolCallRequest[]): number {
  const ids = new Set(toolReqs.map(req => req.toolCallId));
  for (let i = history.length - 1; i >= 0; i--) {
    const item = history[i];
    if (item.type !== "llm-ir") continue;
    const ir = item.ir;
    if (ir.role !== "assistant") continue;
    if ((ir.toolCalls ?? []).some(call => ids.has(call.toolCallId))) return i;
  }
  return -1;
}

export function answeredToolCallIds(history: readonly HistoryNode[], afterIndex = -1): Set<string> {
  const answered = new Set<string>();
  for (let i = afterIndex + 1; i < history.length; i++) {
    const item = history[i];
    if (item.type !== "llm-ir") continue;
    const id = answeredToolCallId(item.ir);
    if (id != null) answered.add(id);
  }
  return answered;
}

export type ToolAction =
  | { kind: "in-flight"; req: ToolCallRequest }
  | { kind: "ready"; req: ToolCallRequest }
  | { kind: "done" };

/*
 * Derives what the tool renderer should do for a batch from the history, rather than tracking a
 * cursor in component state. ToolRequestsRenderer unmounts when the menu opens, and a
 * component-local cursor would reset to 0 on remount, re-running tools that already executed.
 * Deriving from history makes unmount/remount cycles safe: a remounted renderer re-derives the
 * same action. An unanswered in-flight tool yields "in-flight" so the renderer shows progress
 * without re-invoking the tool.
 */
export function nextToolAction(
  toolReqs: ToolCallRequest[],
  runningToolCallId: string | null,
  history: readonly HistoryNode[],
): ToolAction {
  const answered = answeredToolCallIds(history, batchRequestIndex(history, toolReqs));
  const unanswered = toolReqs.filter(
    req => req.type === "tool-call" && !answered.has(req.toolCallId),
  );
  if (runningToolCallId != null) {
    const running = unanswered.find(req => req.toolCallId === runningToolCallId);
    if (running) return { kind: "in-flight", req: running };
  }
  const [first] = unanswered;
  if (first) return { kind: "ready", req: first };
  return { kind: "done" };
}

async function waitForPermissionDecision(
  gate: PermissionGate<typeof octoAgent>,
  req: ToolCallRequest,
  signal: AbortSignal,
): Promise<Result<PermissionDecision, "aborted">> {
  if (signal.aborted) return err("aborted");
  let onAbort!: () => void;
  const aborted = new Promise<Result<PermissionDecision, "aborted">>(resolve => {
    onAbort = () => resolve(err("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const decision = await Promise.race([gate(req).then(ok), aborted]);
  signal.removeEventListener("abort", onAbort);
  return decision;
}

export const useAppStore = create<UiState>((set, get) => ({
  isMenuOpen: false,
  _notifyTimer: null,
  sessionAutoNotify: false,
  notifyOnce: false,
  modeData: {
    mode: "ready-for-request" as const,
  },
  runningToolCallId: null,
  history: [],
  modelOverride: null,
  quotaData: null,
  byteCount: 0,
  query: "",
  attachedImages: [],
  queuedUserMessages: [],
  clearNonce: 0,
  sessionHydrationNonce: 0,
  lastUserPromptIndex: null,
  permission: {
    rejectionTx: null,
    whitelistState: new Set<string>(),
    unchained: false,
    pendingControl: null,
  },

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

  input: async ({ config, query, transport, session, images }) => {
    const model = getModelFromConfig(config, get().modelOverride);

    const history = appendAndPersistHistory(
      session,
      get().history,
      [userMessageItem(query, images)],
      model,
    );
    set({ history, lastUserPromptIndex: history.length - 1 });
    await get().runAgent({ config, transport, session });
  },

  retryFrom: async (mode, args) => {
    if (get().modeData.mode === mode) {
      await get().runAgent(args);
    }
  },

  clearAuthError: () => {
    if (get().modeData.mode !== "auth-error") return;
    set({ modeData: { mode: "ready-for-request" } });
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
        queuedUserMessages: [],
        modeData: { mode: "ready-for-request" },
      });
      return;
    }

    const lastUserItem = history[lastUserPromptIndex];
    if (!lastUserItem || lastUserItem.type !== "llm-ir" || lastUserItem.ir.role !== "user") {
      set({
        query: "",
        byteCount: 0,
        queuedUserMessages: [],
        modeData: { mode: "ready-for-request" },
      });
      return;
    }

    const filteredHistory = history.slice(0, lastUserPromptIndex);
    const textPart = lastUserItem.ir.content.find(part => part.type === "text");
    set(state => ({
      history: filteredHistory,
      query: textPart?.content ?? "",
      byteCount: 0,
      queuedUserMessages: [],
      clearNonce: state.clearNonce + 1,
      modeData: { mode: "ready-for-request" },
    }));
  },

  abortResponse: (session: Session, config, opts?: { exiting?: boolean }) => {
    const { modeData, runningToolCallId } = get();
    if ("abortController" in modeData) modeData.abortController.abort();
    set(state => ({
      queuedUserMessages: [],
      permission: { ...state.permission, pendingControl: null, rejectionTx: null },
    }));
    if (
      modeData.mode !== "tool-call" &&
      modeData.mode !== "tool-call-permission" &&
      modeData.mode !== "awaiting-steering"
    ) {
      return;
    }

    /*
     * Aborting a tool batch mid-flight leaves every request that never ran unanswered in
     * history; Anthropic hard-400s on unanswered tool calls, and chat-completions models find
     * them out-of-distribution. Mark any unanswered requests as skipped so the next request is
     * well-formed. Normally the currently-running tool is excluded, since it appends its own
     * output when it settles — but when the process is exiting it will never settle, so mark
     * it as skipped too.
     */
    const answered = answeredToolCallIds(
      get().history,
      batchRequestIndex(get().history, modeData.toolReqs),
    );

    const skipped: HistoryItem[] = [];
    for (const req of modeData.toolReqs) {
      if (req.type !== "tool-call") continue;
      if (answered.has(req.toolCallId)) continue;
      const isRunning = req.toolCallId === runningToolCallId;
      if (isRunning && !opts?.exiting) continue;
      skipped.push({
        type: "llm-ir",
        ir: {
          role: "tool-skip-output",
          toolCall: req,
          reason: isRunning
            ? "The user exited while this tool was running, so its output was not recorded"
            : "The user aborted the response, so this tool was skipped",
        },
      });
    }

    if (skipped.length > 0) {
      const model = getModelFromConfig(config, get().modelOverride);
      set({ history: appendAndPersistHistory(session, get().history, skipped, model) });
    }

    /*
     * If no tool is currently running, nothing else will flip the mode back to ready-for-request,
     * so do it here. If a tool is running, runTool's _maybeHandleAbort flips it once the tool
     * settles.
     */
    if (runningToolCallId == null) {
      set({
        modeData: {
          mode: "ready-for-request",
        },
      });
    }
  },

  _maybeHandleAbort: (signal: AbortSignal): boolean => {
    if (signal.aborted) {
      set({
        queuedUserMessages: [],
        modeData: {
          mode: "ready-for-request",
        },
      });
      return true;
    }
    return false;
  },

  toggleMenu: () => {
    if (get().isMenuOpen) {
      set({ isMenuOpen: false });
    } else if (get().modeData.mode === "ready-for-request") {
      set({ isMenuOpen: true });
    }
  },
  closeMenu: () => {
    set({ isMenuOpen: false });
  },
  openMenu: () => {
    set({ isMenuOpen: true });
  },

  setQuery: query => {
    set({ query });
  },

  addAttachedImage: image => {
    set(state => ({ attachedImages: [...state.attachedImages, image] }));
  },

  removeLastAttachedImage: () => {
    set(state => ({ attachedImages: state.attachedImages.slice(0, -1) }));
  },

  clearAttachedImages: () => {
    set({ attachedImages: [] });
  },

  enqueueUserMessage: msg => {
    set(state => ({
      queuedUserMessages: [...state.queuedUserMessages, { ...msg, id: nextQueuedMessageId++ }],
    }));
  },

  _appendQueuedUserMessages: (session, config) => {
    const { queuedUserMessages: queuedMessages } = get();
    const model = getModelFromConfig(config, get().modelOverride);
    if (queuedMessages.length === 0) return;
    const { query, images } = coalesceQueuedUserMessages(queuedMessages);
    const history = appendAndPersistHistory(
      session,
      get().history,
      [userMessageItem(query, images)],
      model,
    );
    set({ history, lastUserPromptIndex: history.length - 1, queuedUserMessages: [] });
  },

  setModelOverride: (model, _session) => {
    set({ modelOverride: serializeModelJson(model) });
  },

  notify: (notif, session, config) => {
    const model = getModelFromConfig(config, get().modelOverride);
    set({
      history: appendAndPersistHistory(
        session,
        get().history,
        [
          {
            type: "notification",
            content: notif,
          },
        ],
        model,
      ),
    });
  },

  hydrateSession: history => {
    const { modeData } = get();
    if ("abortController" in modeData) {
      modeData.abortController.abort();
    }
    const repairedHistory = repairOrphanedToolOutputs(history);
    // Canary builds fail loudly on any remaining pairing violation: after repair, any dangling
    // tool output is an unknown bug we want to hear about rather than resume around.
    if (process.env["CANARY_OCTO"] === "1") assertToolCallPairing(repairedHistory);
    set(state => ({
      history: repairedHistory,
      modelOverride: latestModelJson(history),
      lastUserPromptIndex: null,
      byteCount: 0,
      queuedUserMessages: [],
      clearNonce: state.clearNonce + 1,
      modeData: { mode: "ready-for-request" },
      sessionHydrationNonce: state.sessionHydrationNonce + 1,
      sessionAutoNotify: false,
      // A hydrated session has no in-flight tool; don't leak a stale ID from the previous one.
      runningToolCallId: null,
      permission: { ...state.permission, pendingControl: null, rejectionTx: null },
    }));
  },

  startNewSession: (cwd, cliArgs) => {
    // Abort any ongoing responses to avoid polluting the new cleared state.
    const { modeData } = get();
    if ("abortController" in modeData) {
      modeData.abortController.abort();
    }

    set(state => ({
      history: [],
      lastUserPromptIndex: null,
      byteCount: 0,
      queuedUserMessages: [],
      clearNonce: state.clearNonce + 1,
      sessionAutoNotify: false,
      modeData: { mode: "ready-for-request" },
      isMenuOpen: false,
      // An aborted tool clears this itself when it settles, but until it does the new session
      // must not see the old session's in-flight ID.
      runningToolCallId: null,
      permission: { ...state.permission, pendingControl: null, rejectionTx: null },
    }));
    return createSession(cwd, cliArgs);
  },

  setUnchained: unchained => {
    set(state => ({ permission: { ...state.permission, unchained } }));
  },

  /*
   * Records a rejected tool call: the reject marker for the call itself, plus skip markers for
   * the rest of its batch, so the LLM knows we rejected partway through. This happens the moment
   * the user begins a rejection; the steering message lands separately when they commit it.
   */
  _appendToolRejection: (toolCall, args) => {
    const history = get().history;

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
    const model = getModelFromConfig(args.config, get().modelOverride);
    set({
      history: appendAndPersistHistory(
        args.session,
        get().history,
        [
          {
            type: "llm-ir",
            ir: {
              role: "tool-reject",
              toolCall,
            },
          },
          ...skippedCalls,
        ],
        model,
      ),
    });
  },

  _appendUserSteering: (steering, args) => {
    const model = getModelFromConfig(args.config, get().modelOverride);
    const history = appendAndPersistHistory(
      args.session,
      get().history,
      [userMessageItem(steering)],
      model,
    );
    set({ history, lastUserPromptIndex: history.length - 1 });
  },

  runTool: async ({ config, toolReq, transport, session }) => {
    const { modeData } = get();
    if (modeData.mode !== "tool-call" && modeData.mode !== "tool-call-permission") {
      throw new Error(`Impossible tool mode: ${modeData.mode}`);
    }
    if (get().runningToolCallId != null) {
      if (process.env["CANARY_OCTO"] === "1") {
        throw new Error(
          "Canary build error: attempted to run a tool when a tool was already running",
        );
      }
    }

    const abortController = modeData.abortController;
    set({
      modeData: { ...modeData, mode: "tool-call" },
      runningToolCallId: toolReq.toolCallId,
    });

    const tools = await loadTools(transport, abortController.signal, config);

    const model = getModelFromConfig(config, get().modelOverride);
    const result = await runTool(abortController.signal, transport, tools, toolReq, config, model);
    if (!result.success) {
      set({
        history: appendAndPersistHistory(
          session,
          get().history,
          [
            {
              type: "llm-ir",
              ir: {
                role: "tool-runtime-error",
                error: result.error,
                toolCall: toolReq,
              },
            },
          ],
          model,
        ),
      });
    } else {
      set({
        history: appendAndPersistHistory(
          session,
          get().history,
          [
            {
              type: "llm-ir",
              ir: toolRunResultToIR(result.data, toolReq),
            },
          ],
          model,
        ),
      });
    }

    set({ runningToolCallId: null });

    if (get()._maybeHandleAbort(abortController.signal)) {
      return;
    }
  },

  /*
   * _runAgentOnce runs a single model round-trip (plus any tool batch it requests) and returns
   * whether the turn should continue: finished tool batches, queued messages, and steering all
   * fold into the next iteration instead of recursing.
   */
  runAgent: async args => {
    let shouldContinue = true;
    while (shouldContinue) {
      shouldContinue = await get()._runAgentOnce(args);
    }
  },

  _runAgentOnce: async ({ config, transport, session }) => {
    get()._appendQueuedUserMessages(session, config);
    const historyCopy = [...get().history];
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
        return false;
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
        return false;
      }
      modelData = { type: "api", auth: authResult.auth, model };
    }

    const throttle = throttledBuffer<Partial<Parameters<typeof set>[0]>>(300, set);

    try {
      const tools = await loadTools(transport, abortController.signal, config);
      const finish = await trajectoryArc.run<typeof octoAgent, ModelData>({
        model: modelData,
        contextWindow: model.context,
        messages: lowerOctoToLlmIR(toLlmIR(historyCopy), model.modalities),
        tools,
        toolData: config,
        runCompiler: run,
        lowerMessages: messages => lowerOcto(messages, model.modalities),
        systemPrompt: () =>
          systemPrompt({
            config,
            transport,
            signal: abortController.signal,
          }),
        transport,
        abortSignal: abortController.signal,
        errorCorrection: {
          json: makeAutofixJson(config),
          tools: {
            edit: async ({ toolCall, abortSignal: fixSignal, transport: fixTransport }) => {
              const file = await fixTransport.readFile(fixSignal, toolCall.parsed.filePath);
              const fix = await autofixEdit(config, file, toolCall.parsed, fixSignal);
              if (fix == null) return null;
              return { ...toolCall.parsed, ...fix };
            },
          },
        },
        requestErrorRetries: {
          maxRetryCount: MAX_RETRY_COUNT,
          backoffMs: 2000,
          maxBackoffMs: 30_000,
        },
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

          autofixingJson: () => {
            throttle.flush();
            set({
              modeData: {
                mode: "fix-json",
                abortController,
              },
            });
          },

          autofixingTool: ({ tool }) => {
            if (tool !== "edit") return;
            throttle.flush();
            set({
              modeData: {
                mode: "diff-apply",
                abortController,
              },
            });
          },

          requestRetry: event => {
            throttle.flush();
            set({
              modeData: {
                mode: "request-error-retrying",
                error: event.error.requestError,
                attempt: event.attempt,
                delayMs: event.delayMs,
                abortController: event.abortController,
              },
            });
          },

          onResponseHeaders: headers => {
            const raw = headers.get("x-synthetic-quotas");
            if (raw == null) return;
            const quota = parseQuotaJson(raw);
            if (quota != null) set({ quotaData: quota });
          },

          onMessage: ir => {
            throttle.flush();
            set({
              history: appendAndPersistHistory(
                session,
                get().history,
                [{ type: "llm-ir", ir }],
                model,
              ),
            });
          },
        },
      });
      throttle.flush();
      const finishReason = finish.reason;
      if (finishReason.type === "abort") {
        get().notifyReadyForInput(config);
        set({
          queuedUserMessages: [],
          modeData: { mode: "ready-for-request" },
        });
        return false;
      }
      if (finishReason.type === "needs-response") {
        if (get().queuedUserMessages.length > 0) return true;
        get().notifyReadyForInput(config);
        set({ modeData: { mode: "ready-for-request" } });
        return false;
      }

      if (finishReason.type === "request-error") {
        set({
          modeData: {
            mode: "request-error",
            error: finishReason.requestError,
            curlCommand: finishReason.curl,
          },
        });
        return false;
      }

      if (finishReason.type === "payment-error") {
        set({ modeData: { mode: "payment-error", error: finishReason.requestError } });
        return false;
      }

      if (finishReason.type === "rate-limit-error") {
        set({ modeData: { mode: "rate-limit-error", error: finishReason.requestError } });
        return false;
      }

      if (finishReason.type === "request-error-retry-budget-exceeded") {
        const error = finishReason.error;
        if (error.type === "rate-limit-error") {
          set({ modeData: { mode: "rate-limit-error", error: error.requestError } });
          return false;
        }
        set({
          modeData: {
            mode: "request-error",
            error: error.requestError,
            curlCommand: error.curl,
          },
        });
        return false;
      }

      if (finishReason.type === "auth-error") {
        set({
          modeData: {
            mode: "auth-error",
            model,
            error: { type: "invalid", message: finishReason.authError },
          },
        });
        return false;
      }

      if (finishReason.type === "compaction-error") {
        set({
          modeData: {
            mode: "compaction-error",
            error: finishReason.requestError,
            curlCommand: finishReason.curl,
          },
          history: appendAndPersistHistory(
            session,
            get().history,
            [
              {
                type: "compaction-failed",
              },
            ],
            model,
          ),
        });
        return false;
      }

      const toolReqs = finishReason.toolCalls;
      set({
        modeData: {
          mode: "tool-call",
          toolReqs,
          abortController,
        },
        runningToolCallId: null,
      });

      if (abortController.signal.aborted) return false;

      const gate = octoPermissionGate({
        state: {
          rejectionTx: get().permission.rejectionTx,
          whitelistState: get().permission.whitelistState,
        },
        setState: update => {
          set(state => ({ permission: { ...state.permission, ...update } }));
          if (update.rejectionTx != null) {
            // A rejection opens the steering window: record it in history immediately.
            const { permission: currentPermission, modeData: currentMode } = get();
            if (currentPermission.pendingControl != null) {
              get()._appendToolRejection(currentPermission.pendingControl.toolCall, {
                config,
                transport,
                session,
              });
            }
            if (currentMode.mode === "tool-call-permission") {
              set(state => ({
                modeData: { ...currentMode, mode: "awaiting-steering" },
                permission: { ...state.permission, pendingControl: null },
              }));
            }
          }
          return update;
        },
        controller: control => {
          const { permission, modeData: currentMode } = get();
          const toolCall = control.toolCall;
          if (
            permission.unchained ||
            SKIP_CONFIRMATION_TOOLS.includes(toolCall.name) ||
            permission.whitelistState.has(whitelistKey(toolCall))
          ) {
            control.allow();
            return;
          }
          if (currentMode.mode === "tool-call") {
            set({ modeData: { ...currentMode, mode: "tool-call-permission" } });
          }
          set(state => ({ permission: { ...state.permission, pendingControl: control } }));
          get().notifyReadyForInput(config);
        },
      });

      for (const req of toolReqs) {
        const decision = await waitForPermissionDecision(gate, req, abortController.signal);
        if (!decision.success) return false;

        if (decision.data.decision === "reject") {
          get()._appendUserSteering(decision.data.steering, { config, transport, session });
          return true;
        }

        set(state => ({ permission: { ...state.permission, pendingControl: null } }));
        await get().runTool({ config, transport, session, toolReq: req });

        const current = get().modeData;
        if (current.mode !== "tool-call" && current.mode !== "tool-call-permission") return false;
      }

      return true;
    } catch (e) {
      if (get()._maybeHandleAbort(abortController.signal)) {
        return false;
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
