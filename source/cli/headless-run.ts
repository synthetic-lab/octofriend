import { getModelFromConfig, readAuthForModel, type Config } from "../config.ts";
import type { Compiler } from "../libocto/compilers/compiler-interface.ts";
import { contentText } from "../libocto/llm-ir.ts";
import { Trajectory, type TrajectoryMode } from "../libocto/trajectory.ts";
import type { Transport } from "../transports/transport-common.ts";
import { shutdownLspClients } from "../lsp/client.ts";
import { shutdownMcpClients } from "../tools/tool-defs/mcp.ts";
import { processes } from "../process-manager.ts";
import type { ModelData } from "../compilers/run.ts";
import {
  createSession,
  insertHistoryItems,
  loadSession,
  latestModelJson,
  SessionNotFoundError,
  type HistoryItem,
  type HistoryNode,
  type Session,
} from "../session-history/index.ts";
import { serializeModelJson } from "../session-history/model-json.ts";
import { repairOrphanedToolOutputs } from "../session-history/tool-pairing.ts";
import { toLlmIR } from "../ir/convert-history-ir.ts";
import { octoPermissionGate, whitelistKey, type OctoGateState } from "../octo-permissions.ts";
import { SKIP_CONFIRMATION_TOOLS } from "../tools/index.ts";
import { tokenCounts } from "../token-tracker.ts";
import { userMessageContent } from "../state.ts";
import { octoSharedTrajectoryParams, TOOL_OUTPUT_TOO_LARGE_PREFIX } from "../trajectory-params.ts";
import type { octoAgent, OctoIR } from "../ir/octo-ir.ts";

export const HEADLESS_RUN_JSON_VERSION = "octo-run/v1" as const;

export type HeadlessOutputFormat = "text" | "json" | "jsonl";

export type HeadlessRunStatus = "completed" | "error" | "timeout" | "max-turns";

export type HeadlessRunError = { type: string; message: string };

export type HeadlessRunResult = {
  version: typeof HEADLESS_RUN_JSON_VERSION;
  sessionId: string | null;
  status: HeadlessRunStatus;
  result: string;
  turns: number;
  usage: Record<string, { input: number; output: number }>;
  deniedTools: string[];
  truncated: boolean;
  error?: HeadlessRunError;
};

export type HeadlessRunDeps = {
  config: Config;
  configPath?: string;
  transport: Transport;
  runCompiler?: Compiler<ModelData>;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
};

export type HeadlessRunOptions = {
  prompt: string;
  resume?: string;
  modelNickname?: string;
  outputFormat: HeadlessOutputFormat;
  unchained: boolean;
  allowTools: readonly string[];
  maxTurns?: number;
  timeoutMs?: number;
};

export const EXIT_OK = 0;
export const EXIT_RUNTIME_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_STOPPED = 3;

// Keeps jsonl tool events small; the full output is always in the persisted session history.
const MAX_EVENT_CHARS = 1000;

type OctoMode = TrajectoryMode<typeof octoAgent>;

function excerpt(text: string): string {
  if (text.length <= MAX_EVENT_CHARS) return text;
  return text.slice(0, MAX_EVENT_CHARS) + "…";
}

// --allow-tool maps onto the same grouping the interactive whitelist uses: approving one file
// edit tool approves the group, since whitelistKey collapses them.
const EDIT_GROUP = ["create", "rewrite", "edit"];
const READ_GROUP = ["read", "partial-read", "list"];

function buildAllowedTools(allowTools: readonly string[]): Set<string> {
  const allowed = new Set<string>();
  for (const name of allowTools) {
    allowed.add(name);
    if (EDIT_GROUP.includes(name)) allowed.add("edits:*");
    if (READ_GROUP.includes(name)) allowed.add("read:*");
  }
  return allowed;
}

export async function headlessRun(
  deps: HeadlessRunDeps,
  options: HeadlessRunOptions,
): Promise<{ exitCode: number; result: HeadlessRunResult }> {
  const { config, transport, stdout, stderr } = deps;
  const format = options.outputFormat;

  let sessionId: string | null = null;
  let session: Session;
  let resultText = "";
  let turns = 0;
  let truncated = false;
  const deniedTools: string[] = [];
  let initEmitted = false;

  const emitEvent = (event: Record<string, unknown>) => {
    if (format === "jsonl") stdout(JSON.stringify(event) + "\n");
  };

  const emitInit = (resumed: boolean) => {
    if (initEmitted) return;
    // The session ID is generated lazily by the first history insert, so read it from the
    // session (assigned by then) rather than the outer sessionId (only set at the end).
    const id = session.metadata.sessionId ?? sessionId;
    if (id == null) return;
    initEmitted = true;
    emitEvent({ type: "init", version: HEADLESS_RUN_JSON_VERSION, sessionId: id, resumed });
  };

  const finish = (
    status: HeadlessRunStatus,
    exitCode: number,
    error?: HeadlessRunError,
  ): { exitCode: number; result: HeadlessRunResult } => {
    const result: HeadlessRunResult = {
      version: HEADLESS_RUN_JSON_VERSION,
      sessionId,
      status,
      result: resultText,
      turns,
      usage: structuredClone(tokenCounts()),
      deniedTools,
      truncated,
      ...(error != null ? { error } : {}),
    };
    if (format === "json") {
      stdout(JSON.stringify(result, null, 2) + "\n");
    } else if (format === "jsonl") {
      emitEvent({ type: "result", ...result });
    } else {
      if (resultText.length > 0) stdout("\n");
      if (error != null) stderr(`\nError (${error.type}): ${error.message}\n`);
      if (deniedTools.length > 0) {
        stderr(`Tools denied by permission policy: ${deniedTools.join(", ")}\n`);
      }
      if (sessionId != null) {
        stderr(
          `Session: ${sessionId} (continue with: octo run --resume ${sessionId} "<prompt>")\n`,
        );
      }
    }
    return { exitCode, result };
  };

  const failUsage = (error: HeadlessRunError) => {
    if (format === "text") stderr(`Error (${error.type}): ${error.message}\n`);
    return finish("error", EXIT_USAGE_ERROR, error);
  };

  // Resolve the session and its history.
  let history: HistoryNode[];
  let resumed = false;
  if (options.resume != null) {
    const loaded = loadSession(options.resume);
    if (loaded == null) {
      sessionId = options.resume;
      return failUsage({
        type: "session-not-found",
        message: `No session found with ID ${options.resume}.`,
      });
    }
    resumed = true;
    session = loaded.session;
    history = [...repairOrphanedToolOutputs(loaded.history)];
  } else {
    session = createSession(transport.cwd, {
      kind: "local",
      config: deps.configPath,
      unchained: options.unchained || undefined,
    });
    history = [];
  }

  // Resolve the model: --model wins, then the session's last-used model, then the default.
  let modelOverride: string | null = null;
  if (options.modelNickname != null) {
    const model = config.models.find(m => m.nickname === options.modelNickname);
    if (model == null) {
      if (format === "text") {
        stderr(
          "The available models are:\n- " + config.models.map(m => m.nickname).join("\n- ") + "\n",
        );
      }
      return failUsage({
        type: "unknown-model",
        message: `No model with the nickname ${options.modelNickname} found. Did you add it to Octo?`,
      });
    }
    modelOverride = serializeModelJson(model);
  } else {
    modelOverride = latestModelJson(history);
  }

  const getConfig = () => config;
  const getModel = () => getModelFromConfig(config, modelOverride);

  // Headless can't run the interactive auth preflight, so auth problems are plain errors.
  const model = getModel();
  const authResult = await readAuthForModel(model, config);
  if (!authResult.ok) {
    return failUsage({ type: "auth-error", message: authResult.error.message });
  }

  let persistedHistory = history;
  const persist = (items: HistoryItem[]) => {
    const parentNodeId = persistedHistory.at(-1)?.nodeId ?? null;
    const inserted = insertHistoryItems(
      session,
      parentNodeId,
      items,
      serializeModelJson(getModel()),
    );
    persistedHistory = [...persistedHistory, ...inserted];
  };

  type Outcome =
    | { status: "completed" }
    | { status: "error"; error: HeadlessRunError }
    | { status: "timeout" }
    | { status: "max-turns" };
  let outcome: Outcome | null = null;
  let sawActive = false;

  const exitController = new AbortController();
  const finishTurn = (o: Outcome) => {
    if (outcome != null) return;
    outcome = o;
    exitController.abort();
  };

  const onMessage = (ir: OctoIR) => {
    try {
      persist([{ type: "llm-ir", ir }]);
    } catch (e) {
      if (e instanceof SessionNotFoundError) {
        finishTurn({
          status: "error",
          error: { type: "session-lost", message: e.message },
        });
        return;
      }
      throw e;
    }
    emitInit(resumed);

    switch (ir.role) {
      case "user":
        emitEvent({ type: "user", text: excerpt(contentText(ir.content)) });
        break;
      case "assistant": {
        turns += 1;
        if (ir.content.length > 0) resultText = ir.content;
        emitEvent({
          type: "assistant",
          text: excerpt(ir.content),
          ...(ir.reasoningContent ? { reasoning: excerpt(ir.reasoningContent) } : {}),
        });
        for (const call of ir.toolCalls ?? []) {
          if (call.type !== "tool-call") continue;
          emitEvent({
            type: "tool-call",
            name: call.name,
            arguments: excerpt(JSON.stringify(call.original)),
          });
        }
        if (options.maxTurns != null && turns > options.maxTurns) {
          finishTurn({ status: "max-turns" });
        }
        break;
      }
      case "tool-output":
        emitEvent({
          type: "tool-result",
          name: ir.toolCall.name,
          ok: true,
          text: excerpt(contentText(ir.content)),
        });
        break;
      case "tool-runtime-error":
      case "tool-validation-error": {
        if (ir.error.startsWith(TOOL_OUTPUT_TOO_LARGE_PREFIX)) truncated = true;
        emitEvent({
          type: "tool-result",
          name: ir.toolCall.name,
          ok: false,
          text: excerpt(ir.error),
        });
        break;
      }
      case "tool-skip-output":
        emitEvent({
          type: "tool-result",
          name: ir.toolCall.name,
          ok: false,
          text: excerpt(ir.reason),
        });
        break;
      case "tool-reject":
        emitEvent({ type: "tool-denied", name: ir.toolCall.name });
        break;
    }
  };

  const modeChange = (mode: OctoMode) => {
    if (mode.mode !== "ready-for-request" && mode.mode !== "aborted") sawActive = true;
    switch (mode.mode) {
      case "ready-for-request":
        if (sawActive) finishTurn({ status: "completed" });
        break;
      case "request-error":
      case "compaction-error":
        finishTurn({
          status: "error",
          error: { type: mode.mode, message: mode.requestError },
        });
        break;
      case "payment-error":
      case "rate-limit-error":
        finishTurn({
          status: "error",
          error: { type: mode.mode, message: mode.requestError },
        });
        break;
      case "auth-error":
        finishTurn({
          status: "error",
          error: { type: "auth-error", message: mode.authError },
        });
        break;
    }
  };

  // Permission policy: no prompting is possible headless, so tools are either auto-allowed by
  // policy or rejected with steering that tells the model to continue without them.
  const allowedTools = buildAllowedTools(options.allowTools);
  const gateState: OctoGateState = { rejectionTx: null, whitelistState: new Set(allowedTools) };
  const permission = octoPermissionGate({
    state: gateState,
    onWhitelist: whitelistState => {
      gateState.whitelistState = whitelistState;
    },
    onBeginRejection: rejectionTx => {
      gateState.rejectionTx = rejectionTx;
    },
    onCommitRejection: () => {
      gateState.rejectionTx = null;
    },
    controller: control => {
      const toolCall = control.toolCall;
      if (
        options.unchained ||
        (SKIP_CONFIRMATION_TOOLS as readonly string[]).includes(toolCall.name) ||
        allowedTools.has(toolCall.name) ||
        allowedTools.has(whitelistKey(toolCall))
      ) {
        control.allow();
        return;
      }
      if (!deniedTools.includes(toolCall.name)) deniedTools.push(toolCall.name);
      control.beginReject().commitRejection([
        {
          type: "text",
          content:
            `The headless permission policy denied the tool "${toolCall.name}" ` +
            `(rerun with --unchained or --allow-tool ${toolCall.name} to allow it). ` +
            `Do not retry this tool; continue the task without it, or explain what you would have used it for.`,
        },
      ]);
    },
  });

  const trajectory = new Trajectory({
    ...octoSharedTrajectoryParams({
      config,
      getConfig,
      getModel,
      transport,
      runCompiler: deps.runCompiler,
    }),
    messages: toLlmIR(history),
    abortSignal: exitController.signal,
    permission,
    handler: {
      modeChange,
      onMessage,
      responseProgress: event => {
        if (format !== "text") return;
        if (event.delta.type === "reasoning") stderr(event.delta.value);
        else if (event.delta.type === "content") stdout(event.delta.value);
      },
    },
  });

  try {
    const initialMode = trajectory.mode;
    if (initialMode.mode === "ready-for-request") {
      await initialMode.control.enqueueSteering(userMessageContent(options.prompt));
    }

    const timeoutTimer =
      options.timeoutMs != null
        ? setTimeout(() => finishTurn({ status: "timeout" }), options.timeoutMs)
        : null;

    try {
      await trajectory.run();
    } catch (e) {
      if (outcome == null) {
        outcome = {
          status: "error",
          error: { type: "fatal", message: e instanceof Error ? e.message : String(e) },
        };
      }
    } finally {
      if (timeoutTimer != null) clearTimeout(timeoutTimer);
    }
  } finally {
    await Promise.all([
      shutdownLspClients(),
      shutdownMcpClients(),
      processes.manager().terminateOnOctoExit(),
    ]);
  }

  sessionId = session.metadata.sessionId;
  // Read through a function so TS's flow analysis doesn't narrow `outcome` to only the
  // assignments visible in this scope (finishTurn assigns it from trajectory callbacks).
  const getOutcome = (): Outcome | null => outcome;
  const finalOutcome = getOutcome();
  if (finalOutcome == null) return finish("completed", EXIT_OK);
  switch (finalOutcome.status) {
    case "completed":
      return finish("completed", EXIT_OK);
    case "timeout":
      return finish("timeout", EXIT_STOPPED);
    case "max-turns":
      return finish("max-turns", EXIT_STOPPED);
    case "error":
      return finish("error", EXIT_RUNTIME_ERROR, finalOutcome.error);
  }
}
