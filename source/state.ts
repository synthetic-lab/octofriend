import {
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
  SessionNotFoundError,
} from "./session-history/index.ts";
import { serializeModelJson } from "./session-history/model-json.ts";
import {
  assertToolCallPairing,
  repairOrphanedToolOutputs,
} from "./session-history/tool-pairing.ts";
import type { ParsedCliArgs } from "./cli/cli-args.ts";
import { create } from "zustand";
import { useShallow } from "zustand/shallow";
import { toLlmIR } from "./ir/convert-history-ir.ts";
import { Transport } from "./transports/transport-common.ts";
import { run, type ModelData } from "./compilers/run.ts";
import type { Compiler } from "./libocto/compilers/compiler-interface.ts";
import type { MultimodalConfig } from "./libocto/modalities.ts";
import { lowerOctoToLlmIR } from "./compilers/lower-octo.ts";
import { autofixEdit, makeAutofixJson } from "./compilers/autofix.ts";
import { systemPrompt } from "./prompts/system-prompt.ts";
import { messageText, type UserMessage } from "./libocto/llm-ir.ts";
import { err, ok, type Result } from "./libocto/result.ts";
import {
  Trajectory,
  DEFAULT_MAX_TOOL_OUTPUT_FRACTION,
  type TrajectoryMode,
  type TrajectoryModelError,
} from "./libocto/trajectory.ts";
import {
  octoPermissionGate,
  whitelistKey,
  type OctoGateState,
  type OctoPermissionControl,
  type RejectionTransaction,
} from "./octo-permissions.ts";
import { parseQuotaJson, QuotaData } from "./utils/quota.ts";
import { throttledBuffer } from "./throttled-buffer.ts";
import { loadTools, SKIP_CONFIRMATION_TOOLS } from "./tools/index.ts";
import { estimateTokens } from "./ir/count-ir-tokens.ts";
import { octoAgent, type OctoIR } from "./ir/octo-ir.ts";

export const MAX_RETRY_COUNT = 20;

export type InflightResponseType = {
  type: "inflight-response";
  content: string;
  reasoningContent?: string | null;
};

export type PermissionUiState =
  | { type: "idle" }
  | { type: "prompt"; control: OctoPermissionControl }
  | { type: "awaiting-steering"; rejectionTx: RejectionTransaction };

export type LiveMirror = {
  trajectoryMode: TrajectoryMode<typeof octoAgent>;
  permissionUi: PermissionUiState;
};

export type LiveTrajectory = {
  instance: Trajectory<typeof octoAgent, ModelData>;
  exitController: AbortController;
  runPromise: Promise<void>;
};

export type BootEnv = {
  config: Config;
  transport: Transport;
  runCompiler?: Compiler<ModelData>;
};

type SessionControls = {
  hydrate: (args: BootEnv & { session: Session; history: readonly HistoryNode[] }) => Promise<void>;
  newSession: (cwd: string, cliArgs: ParsedCliArgs, env: BootEnv) => Promise<Session>;
};

export type SessionMode =
  | { mode: "booting"; control: SessionControls }
  | {
      mode: "live";
      config: Config;
      transport: Transport;
      session: Session;
      trajectory: LiveTrajectory;
      liveMode: LiveMirror;
      control: SessionControls & { updateConfig: (config: Config) => void };
    }
  | {
      mode: "lost";
      config: Config;
      transport: Transport;
      sessionId: string | null;
      sessionLostError: string;
    };

export function userMessageContent(query: string, images?: ImageInfo[]): UserMessage["content"] {
  return [
    { type: "text", content: query },
    ...(images ?? []).map(image => ({ type: "image" as const, image })),
  ];
}

// Maps each trajectory IR to its persisted history node, so we can find it later.
const irNodeMap = new WeakMap<OctoIR, HistoryNode>();

const PREVIEW_CHARS = 200;

export type UiState = {
  isMenuOpen: boolean;
  _notifyTimer: NodeJS.Timeout | null;
  sessionAutoNotify: boolean;
  notifyOnce: boolean;

  sessionMode: SessionMode;

  inflightResponse: InflightResponseType | null;
  queuedSteering: readonly UserMessage["content"][];

  modelOverride: string | null;
  quotaData: QuotaData | null;
  byteCount: number;
  query: string;
  attachedImages: ImageInfo[];
  clearNonce: number;
  sessionHydrationNonce: number;
  whitelistState: Set<string>;
  unchained: boolean;
  readonly history: readonly HistoryNode[];

  notifyReadyForInput: (config: Config) => void;
  cancelNotifyReadyForInput: () => void;
  setNotifyOnce: (notifyOnce: boolean) => void;
  setNotifySession: (notifySession: boolean) => void;
  notify: (notif: string) => void;
  toggleMenu: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  setModelOverride: (m: ModelConfig) => void;
  setQuery: (query: string) => void;
  addAttachedImage: (image: ImageInfo) => void;
  removeLastAttachedImage: () => void;
  clearAttachedImages: () => void;
  setUnchained: (unchained: boolean) => void;
};

export function inputFieldAvailable(
  trajectoryMode: TrajectoryMode<typeof octoAgent>,
  permissionUi: PermissionUiState,
): boolean {
  if (permissionUi.type === "awaiting-steering") return true;
  if (permissionUi.type === "prompt") return false;
  switch (trajectoryMode.mode) {
    case "tool-call-permission":
    case "request-error":
    case "compaction-error":
    case "payment-error":
    case "rate-limit-error":
    case "auth-error":
    case "aborted":
      return false;
    // DO NOT turn these cases into "default".
    // each new mode should consider whether the input field should be available
    case "ready-for-request":
    case "responding":
    case "compacting":
    case "autofix-json":
    case "autofix-tool":
    case "request-error-retrying":
    case "tool-call":
    case "running-tool":
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

// The inflight mirror belongs to the root conversation; child streams only tick the byte
// count, so their scopes leave the mirror untouched.
function updateInflightResponse(
  event: { root: boolean },
  state: UiState,
  inflightResponse: InflightResponseType,
): InflightResponseType | null {
  if (!event.root) return state.inflightResponse;
  return inflightResponse;
}

export const useAppStore = create<UiState>((set, get) => {
  const currentConfig = (): Config => {
    const mode = get().sessionMode;
    if (mode.mode === "booting") {
      throw new Error("trajectory callbacks require a booted session");
    }
    return mode.config;
  };

  const currentModel = (): ModelConfig => {
    return getModelFromConfig(currentConfig(), get().modelOverride);
  };

  const setPermissionUi = (permissionUi: PermissionUiState) => {
    set(state =>
      state.sessionMode.mode !== "live"
        ? {}
        : {
            sessionMode: {
              ...state.sessionMode,
              liveMode: { ...state.sessionMode.liveMode, permissionUi },
            },
          },
    );
  };

  const createTrajectory = (args: {
    session: Session;
    history: readonly HistoryNode[];
    config: Config;
    transport: Transport;
    runCompiler: Compiler<ModelData>;
  }): LiveTrajectory => {
    const { session, history, config, transport, runCompiler } = args;
    const exitController = new AbortController();
    const throttle = throttledBuffer<Partial<UiState>>(300, set);
    let responseByteCount = 0;
    let compactionByteCount = 0;

    const isCurrent = () => {
      const mode = get().sessionMode;
      return mode.mode === "live" && mode.trajectory.instance === instance;
    };

    const gateState: OctoGateState = {
      rejectionTx: null,
      whitelistState: get().whitelistState,
    };

    const insertIr = (ir: OctoIR) => {
      set(state => ({
        history: appendAndPersistHistory(
          session,
          state.history,
          [{ type: "llm-ir", ir }],
          currentModel(),
        ),
      }));
      const node = get().history.at(-1);
      if (node != null) irNodeMap.set(ir, node);
    };

    const instance = new Trajectory({
      agent: octoAgent,
      messages: toLlmIR([...history]),
      abortSignal: exitController.signal,
      systemPrompt: signal => systemPrompt({ config: currentConfig(), transport, signal }),
      // octo declares no subagents yet: an agentless tree takes an empty catalogue.
      subagentPrompts: {},
      model: async (): Promise<
        Result<
          { model: ModelData; contextWindow: number; modalities: MultimodalConfig | null },
          TrajectoryModelError
        >
      > => {
        const model = currentModel();
        if (model.type === "codex") {
          const authResult = await readAuthForModel(model, currentConfig());
          if (!authResult.ok) {
            return err({ type: "auth-error", authError: authResult.error.message });
          }
          return ok({
            model: { type: "codex", auth: authResult.auth, model },
            contextWindow: model.context,
            modalities: model.modalities ?? null,
          });
        }
        const authResult = await readAuthForModel(model, currentConfig());
        if (!authResult.ok) {
          return err({ type: "auth-error", authError: authResult.error.message });
        }
        return ok({
          model: { type: "api", auth: authResult.auth, model },
          contextWindow: model.context,
          modalities: model.modalities ?? null,
        });
      },
      loadTools: signal => loadTools(transport, signal, currentConfig()),
      countTokens: irs => irs.reduce((tokens, ir) => tokens + estimateTokens(messageText(ir)), 0),
      toolContentTooLargeError: async ir => {
        let text = "";
        if (ir.role === "tool-output") {
          for (const part of ir.content) {
            if (part.type === "text") text += part.content;
          }
        } else if (ir.role === "file-read" || ir.role === "file-mutate") {
          text = ir.content;
        }
        const model = currentModel();
        const tokens = estimateTokens(text);
        const preview = text.slice(0, PREVIEW_CHARS);
        return (
          `Tool output was too large: approximately ${tokens} tokens, which is ` +
          `${DEFAULT_MAX_TOOL_OUTPUT_FRACTION * 100}% or more of the model's ` +
          `${model.context}-token context window. The output was discarded to protect the ` +
          `context window. Retry with a more targeted approach: page through the file with ` +
          `partial-read using offset/limit, narrow searches with tighter patterns or ` +
          `maxResults, or limit shell output (e.g. pipe through head/tail/grep). Before it ` +
          `was discarded, the first ${PREVIEW_CHARS} characters were preserved so you can ` +
          `inspect them; here they are:\n${preview}`
        );
      },
      toolData: config,
      runCompiler,
      lowerMessages: lowerOctoToLlmIR,
      transport,
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
      permission: octoPermissionGate({
        state: gateState,
        onWhitelist: whitelistState => {
          gateState.whitelistState = whitelistState;
          set({ whitelistState });
        },
        onBeginRejection: rejectionTx => {
          if (!isCurrent()) return;
          setPermissionUi({ type: "awaiting-steering", rejectionTx });
        },
        onCommitRejection: () => {
          if (!isCurrent()) return;
          setPermissionUi({ type: "idle" });
        },
        controller: control => {
          if (!isCurrent()) {
            control.allow();
            return;
          }
          const { unchained, whitelistState } = get();
          const toolCall = control.toolCall;
          if (
            unchained ||
            SKIP_CONFIRMATION_TOOLS.includes(toolCall.name) ||
            whitelistState.has(whitelistKey(toolCall))
          ) {
            control.allow();
            return;
          }
          setPermissionUi({ type: "prompt", control });
          get().notifyReadyForInput(config);
        },
      }),
      handler: {
        modeChange: ({ mode }) => {
          if (!isCurrent()) return;
          throttle.flush();
          set(state => {
            if (state.sessionMode.mode !== "live") return {};
            const streaming = mode.mode === "responding" || mode.mode === "compacting";
            return {
              sessionMode: {
                ...state.sessionMode,
                liveMode: { trajectoryMode: mode, permissionUi: { type: "idle" } },
              },
              inflightResponse: (() => {
                // Children never alter inflight response state.
                if (!mode.root) return state.inflightResponse;
                // Moving to a non-streaming root mode clears any inflight response.
                if (!streaming) return null;
                return state.inflightResponse;
              })(),
              byteCount: streaming ? state.byteCount : 0,
            };
          });
          if (mode.mode === "ready-for-request") get().notifyReadyForInput(config);
        },
        onMessage: ({ root, ir }) => {
          // Octo currently has no subagents, so every event is root-scoped. When it gains
          // them, child IRs must not be inserted as flat root history: insert the event's
          // scope.toplevelSubagentIR on its first child append, then use irNodeMap to overwrite
          // that same persisted node as the trajectory grows in place.
          const _: true = root;
          if (!isCurrent()) return;
          throttle.flush();
          try {
            insertIr(ir);
          } catch (e) {
            if (e instanceof SessionNotFoundError) {
              set(state =>
                state.sessionMode.mode !== "live"
                  ? {}
                  : {
                      sessionMode: {
                        mode: "lost",
                        config: state.sessionMode.config,
                        transport: state.sessionMode.transport,
                        sessionId: session.metadata.sessionId,
                        sessionLostError: e.message,
                      },
                    },
              );
              exitController.abort();
              return;
            }
            throw e;
          }
        },
        rewind: ({ removed, content }) => {
          if (!isCurrent()) return;
          set(state => {
            let history = state.history;
            if (removed.length > 0) {
              const first = irNodeMap.get(removed[0]);
              if (first == null) throw new Error("rewind target is missing from history");
              history = history.slice(
                0,
                history.findIndex(node => node.nodeId === first.nodeId),
              );
            }
            const textPart = content?.find(part => part.type === "text");
            return {
              history,
              query: textPart?.content ?? "",
              clearNonce: state.clearNonce + 1,
            };
          });
        },
        steeringChange: ({ queued }) => {
          if (!isCurrent()) return;
          set({ queuedSteering: queued });
        },
        startResponse: event => {
          if (!isCurrent()) return;
          throttle.flush();
          responseByteCount = 0;
          set(state => ({
            inflightResponse: updateInflightResponse(event, state, {
              type: "inflight-response",
              content: "",
            }),
            byteCount: 0,
          }));
        },
        responseProgress: ({ root, payload: event }) => {
          if (!isCurrent()) return;
          responseByteCount += event.delta.value.length;
          if (!root) {
            throttle.emit({ byteCount: responseByteCount });
            return;
          }
          throttle.emit({
            inflightResponse: {
              type: "inflight-response",
              reasoningContent: event.buffer.reasoning,
              content: event.buffer.content || "",
            },
            byteCount: responseByteCount,
          });
        },
        startCompaction: event => {
          if (!isCurrent()) return;
          throttle.flush();
          compactionByteCount = 0;
          set(state => ({
            inflightResponse: updateInflightResponse(event, state, {
              type: "inflight-response",
              content: "",
            }),
            byteCount: 0,
          }));
        },
        compactionProgress: ({ root, payload: event }) => {
          if (!isCurrent()) return;
          compactionByteCount += event.delta.value.length;
          if (!root) {
            throttle.emit({ byteCount: compactionByteCount });
            return;
          }
          throttle.emit({
            inflightResponse: {
              type: "inflight-response",
              reasoningContent: event.buffer.reasoning,
              content: event.buffer.content || "",
            },
            byteCount: compactionByteCount,
          });
        },
        onResponseHeaders: ({ payload: headers }) => {
          if (!isCurrent()) return;
          const raw = headers.get("x-synthetic-quotas");
          if (raw == null) return;
          const quota = parseQuotaJson(raw);
          if (quota != null) set({ quotaData: quota });
        },
      },
    });

    return {
      instance,
      exitController,
      runPromise: instance.run().catch(e => {
        console.error(e);
        process.exit(1);
      }),
    };
  };

  const swapInto = async (
    args: BootEnv & { session: Session; history: readonly HistoryNode[] },
  ): Promise<void> => {
    const current = get().sessionMode;
    if (current.mode === "live") {
      current.trajectory.exitController.abort();
      await current.trajectory.runPromise;
    }
    const repairedHistory = repairOrphanedToolOutputs(args.history);
    // Canary builds fail loudly on any remaining pairing violation: after repair, any dangling
    // tool output is an unknown bug we want to hear about rather than resume around.
    if (process.env["CANARY_OCTO"] === "1") assertToolCallPairing(repairedHistory);
    for (const node of repairedHistory) {
      if (node.type === "llm-ir") irNodeMap.set(node.ir, node);
    }
    const trajectory = createTrajectory({
      session: args.session,
      history: repairedHistory,
      config: args.config,
      transport: args.transport,
      runCompiler: args.runCompiler ?? (run as Compiler<ModelData>),
    });
    set(state => ({
      sessionMode: makeLive({
        session: args.session,
        config: args.config,
        transport: args.transport,
        trajectory,
        liveMode: { trajectoryMode: trajectory.instance.mode, permissionUi: { type: "idle" } },
      }),
      history: repairedHistory,
      modelOverride: latestModelJson(repairedHistory),
      inflightResponse: null,
      queuedSteering: [],
      byteCount: 0,
      clearNonce: state.clearNonce + 1,
      sessionHydrationNonce: state.sessionHydrationNonce + 1,
      sessionAutoNotify: false,
    }));
  };

  const newSession = async (
    cwd: string,
    cliArgs: ParsedCliArgs,
    env: BootEnv,
  ): Promise<Session> => {
    const session = createSession(cwd, cliArgs);
    const modelOverride = get().modelOverride;
    await swapInto({ session, history: [], ...env });
    set({ isMenuOpen: false, modelOverride });
    return session;
  };

  const makeLive = (args: {
    session: Session;
    config: Config;
    transport: Transport;
    trajectory: LiveTrajectory;
    liveMode: LiveMirror;
  }): Extract<SessionMode, { mode: "live" }> => ({
    mode: "live",
    ...args,
    control: {
      hydrate: swapInto,
      newSession,
      updateConfig: config => {
        set(state =>
          state.sessionMode.mode !== "live"
            ? {}
            : { sessionMode: { ...state.sessionMode, config } },
        );
      },
    },
  });

  return {
    isMenuOpen: false,
    _notifyTimer: null,
    sessionAutoNotify: false,
    notifyOnce: false,
    sessionMode: {
      mode: "booting",
      control: { hydrate: swapInto, newSession },
    },
    inflightResponse: null,
    queuedSteering: [],
    history: [],
    modelOverride: null,
    quotaData: null,
    byteCount: 0,
    query: "",
    attachedImages: [],
    clearNonce: 0,
    sessionHydrationNonce: 0,
    whitelistState: new Set<string>(),
    unchained: false,

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

    toggleMenu: () => {
      if (get().isMenuOpen) {
        set({ isMenuOpen: false });
        return;
      }
      const { sessionMode } = get();
      if (
        sessionMode.mode === "live" &&
        sessionMode.liveMode.trajectoryMode.mode === "ready-for-request"
      ) {
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

    setModelOverride: model => {
      set({ modelOverride: serializeModelJson(model) });
    },

    notify: notif => {
      const { sessionMode } = get();
      if (sessionMode.mode !== "live") return;
      set({
        history: appendAndPersistHistory(
          sessionMode.session,
          get().history,
          [{ type: "notification", content: notif }],
          currentModel(),
        ),
      });
    },

    setUnchained: unchained => {
      set({ unchained });
    },
  };
});

export function useModel() {
  const { modelOverride } = useAppStore(
    useShallow(state => ({
      modelOverride: state.modelOverride,
    })),
  );
  const config = useConfig();

  return getModelFromConfig(config, modelOverride);
}
