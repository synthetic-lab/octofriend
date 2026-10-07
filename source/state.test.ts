import { existsSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
  inputFieldAvailable,
  useAppStore,
  type PermissionUiState,
  type SessionMode,
} from "./state.ts";
import type { Config } from "./config.ts";
import { db } from "./db/db.ts";
import type { HistoryItem, HistoryNode } from "./session-history/index.ts";
import { createSession, insertHistoryItems } from "./session-history/index.ts";
import { serializeModelJson } from "./session-history/model-json.ts";
import type { OctoPermissionControl } from "./octo-permissions.ts";
import {
  historyItems,
  llmIrs,
  treeNodes,
  trees,
} from "./session-history/schema/session-history-schema.ts";
import { err, ok, type Result } from "./libocto/result.ts";
import type { ModelData } from "./compilers/run.ts";
import {
  compilerUsage,
  type Compiler,
  type CompilerError,
  type CompilerParams,
  type CompilerResult,
  type CompilerSuccessData,
  type CompilerUsage,
} from "./libocto/compilers/compiler-interface.ts";
import {
  answeredToolCallId,
  type Agent,
  type AssistantMessage,
  type LoweredIR,
} from "./libocto/llm-ir.ts";
import type { TrajectoryMode } from "./libocto/trajectory.ts";
import type { LoadedTools, ToolCall } from "./libocto/tool-def.ts";
import type { octoAgent } from "./ir/octo-ir.ts";
import type toolMap from "./tools/tool-defs/index.ts";
import { LocalTransport } from "./transports/local.ts";

/*
 * Integration tests for the octo store wiring around libocto's Trajectory: history persistence
 * (exactly-once, on the same branch), the permission-gate store mirror, error-mode rectification
 * mirrors, and session lifecycle (boot/hydrate/swap/lost). Trajectory semantics themselves are
 * covered by source/libocto/trajectory.test.ts and are not re-tested here.
 */

type OctoAgent = typeof octoAgent;
type OctoAssistant = AssistantMessage<OctoAgent["tools"]>;
type ShellToolCall = Extract<ToolCall<typeof toolMap>, { name: "shell" }>;

const config: Config = {
  yourName: "Test",
  models: [
    {
      nickname: "test-model",
      model: "test-model",
      context: 128_000,
      baseUrl: "http://localhost",
    },
  ],
};

const agentConfig: Config = {
  yourName: "Test",
  models: [
    {
      nickname: "test-model",
      model: "test-model",
      context: 128_000,
      baseUrl: "http://localhost",
      apiEnvVar: "OCTO_STATE_TEST_API_KEY",
    },
  ],
};

const testModelJson = serializeModelJson(config.models[0]);
const agentModelJson = serializeModelJson(agentConfig.models[0]);

// Captured while the store is still in its initial "booting" mode: booting's controls are the
// only boot path reachable from every later store state (the "lost" mode has no controls).
const bootControls = (
  useAppStore.getState().sessionMode as Extract<SessionMode, { mode: "booting" }>
).control;

const tempDirs: string[] = [];
const envBefore = process.env["OCTO_STATE_TEST_API_KEY"];

beforeEach(() => {
  process.env["OCTO_STATE_TEST_API_KEY"] = "test-key";
});

afterEach(async () => {
  const mode = useAppStore.getState().sessionMode;
  if (mode.mode === "live") {
    mode.trajectory.exitController.abort();
    await mode.trajectory.runPromise;
  }
  useAppStore.setState({
    isMenuOpen: false,
    query: "",
    attachedImages: [],
    whitelistState: new Set<string>(),
    unchained: false,
  });
  if (envBefore == null) delete process.env["OCTO_STATE_TEST_API_KEY"];
  else process.env["OCTO_STATE_TEST_API_KEY"] = envBefore;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function shellCall(id: string, cmd: string): ShellToolCall {
  return {
    type: "tool-call",
    name: "shell",
    toolCallId: id,
    original: { cmd, timeout: 60_000 },
    parsed: { cmd, timeout: 60_000 },
  };
}

function unansweredToolCallIds(history: readonly HistoryNode[]): string[] {
  const requested: string[] = [];
  const answered = new Set<string>();
  for (const item of history) {
    if (item.type !== "llm-ir") continue;
    const ir = item.ir;
    if (ir.role === "assistant") {
      for (const call of ir.toolCalls ?? []) {
        requested.push(call.toolCallId);
      }
      continue;
    }
    if (answeredToolCallId(ir) != null) answered.add(answeredToolCallId(ir)!);
  }
  return requested.filter(id => !answered.has(id));
}

function answerCountsByToolCallId(history: readonly HistoryNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of history) {
    if (item.type !== "llm-ir") continue;
    const id = answeredToolCallId(item.ir);
    if (id == null) continue;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function historyRoles(): string[] {
  return useAppStore
    .getState()
    .history.map(node => (node.type === "llm-ir" ? node.ir.role : node.type));
}

function dbNodeCount(sessionId: string): number {
  return db()
    .select({ id: treeNodes.id })
    .from(treeNodes)
    .innerJoin(trees, eq(trees.id, treeNodes.treeId))
    .where(eq(trees.name, sessionId))
    .all().length;
}

function dbLlmIrCount(sessionId: string, marker: string): number {
  return db()
    .select({ json: llmIrs.json })
    .from(llmIrs)
    .innerJoin(historyItems, eq(historyItems.llmIrId, llmIrs.id))
    .innerJoin(treeNodes, eq(treeNodes.historyItemId, historyItems.id))
    .innerJoin(trees, eq(trees.id, treeNodes.treeId))
    .where(eq(trees.name, sessionId))
    .all()
    .filter(row => row.json.includes(marker)).length;
}

async function waitFor<T>(
  cond: () => T | null | false | undefined,
  timeoutMs = 10_000,
): Promise<T> {
  const start = Date.now();
  while (true) {
    const value = cond();
    if (value != null && value !== false) return value;
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (error?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* Mock compiler seam: state.ts lets tests inject a Compiler via BootEnv. */

type Emit = (tokens: string, type: "reasoning" | "content") => Promise<void>;
type CompilerQueueItem = (
  onTokens: Emit,
  params: { abortSignal: AbortSignal },
) =>
  | Result<CompilerSuccessData<OctoAgent>, CompilerError>
  | Promise<Result<CompilerSuccessData<OctoAgent>, CompilerError>>;

function assistantMessage(opts: {
  content?: string;
  usage?: CompilerUsage;
  toolCalls?: OctoAssistant["toolCalls"];
}): OctoAssistant {
  return {
    role: "assistant",
    content: opts.content ?? "",
    usage: opts.usage ?? compilerUsage(1, 1),
    toolCalls: opts.toolCalls,
  };
}

function okResult(output: OctoAssistant): Result<CompilerSuccessData<OctoAgent>, CompilerError> {
  return ok({ output, curl: "curl", headers: new Headers(), usage: output.usage });
}

function plain(content: string): CompilerQueueItem {
  return () => okResult(assistantMessage({ content }));
}

// Parked error mode if a test under-queues: a never-rejected run promise would hit state.ts's
// process.exit crash path and kill the whole test file, so the queue never throws.
const QUEUE_EXHAUSTED: CompilerQueueItem = () =>
  err({
    type: "payment-error",
    requestError: "mock compiler queue exhausted",
    curl: "curl",
    headers: new Headers(),
  });

function makeRunCompiler(queue: CompilerQueueItem[]) {
  const calls: Array<{ irs: Array<LoweredIR<any>> }> = [];
  const runCompiler: Compiler<ModelData> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, ModelData, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    calls.push({ irs: [...params.irs] as Array<LoweredIR<any>> });
    const next = queue.shift() ?? QUEUE_EXHAUSTED;
    const result = await next(params.onTokens, params);
    return result as typeof result & CompilerResult<A, Tools>;
  };
  return { runCompiler, calls };
}

/* Store-driving helpers. */

function currentLive(): Extract<SessionMode, { mode: "live" }> | null {
  const mode = useAppStore.getState().sessionMode;
  return mode.mode === "live" ? mode : null;
}

async function waitTrajectoryMode<M extends TrajectoryMode<OctoAgent>["mode"]>(
  name: M,
  timeoutMs?: number,
): Promise<Extract<TrajectoryMode<OctoAgent>, { mode: M }>> {
  return waitFor(() => {
    const live = currentLive();
    if (live == null) return null;
    const mode = live.liveMode.trajectoryMode;
    if (mode.mode !== name) return null;
    return mode as Extract<TrajectoryMode<OctoAgent>, { mode: M }>;
  }, timeoutMs);
}

async function waitPermissionUi<T extends PermissionUiState["type"]>(
  type: T,
): Promise<Extract<PermissionUiState, { type: T }>> {
  return waitFor(() => {
    const live = currentLive();
    if (live == null) return null;
    const ui = live.liveMode.permissionUi;
    if (ui.type !== type) return null;
    return ui as Extract<PermissionUiState, { type: T }>;
  });
}

async function respond(text: string) {
  const mode = await waitTrajectoryMode("ready-for-request");
  await mode.control.enqueueSteering([{ type: "text", content: text }]);
}

const PARKED_MODES: ReadonlySet<TrajectoryMode<OctoAgent>["mode"]> = new Set([
  "ready-for-request",
  "tool-call-permission",
  "request-error",
  "compaction-error",
  "payment-error",
  "rate-limit-error",
  "auth-error",
]);

// Runs one turn: asserts the trajectory is parked, fires the trigger, and waits for the
// trajectory to unpark and park again. Waiting on the mode alone resolves immediately — the
// trajectory is already parked in ready-for-request after boot — and polling can miss a fast
// turn entirely, so follow mode changes through a store subscription instead.
async function waitForNextTurn(trigger: () => void | Promise<unknown>): Promise<void> {
  const before = currentLive();
  if (before == null) throw new Error("no live session");
  const parkedMode = before.liveMode.trajectoryMode.mode;
  if (!PARKED_MODES.has(parkedMode)) {
    throw new Error(`expected a parked mode before the turn, got ${parkedMode}`);
  }

  let sawUnpark = false;
  const finished = deferred();
  const unsubscribe = useAppStore.subscribe(state => {
    const sessionMode = state.sessionMode;
    if (sessionMode.mode !== "live") return;
    onMode(sessionMode.liveMode.trajectoryMode.mode);
  });
  const finish = () => {
    unsubscribe();
    finished.resolve();
  };
  const onMode = (mode: TrajectoryMode<OctoAgent>["mode"]) => {
    if (mode !== parkedMode) sawUnpark = true;
    if (sawUnpark && mode === "ready-for-request") finish();
  };
  const afterSubscribe = currentLive();
  if (afterSubscribe == null) {
    unsubscribe();
    throw new Error("session left the live mode mid-turn");
  }
  onMode(afterSubscribe.liveMode.trajectoryMode.mode);

  try {
    await trigger();
    const timeout = setTimeout(() => {
      unsubscribe();
      finished.reject(new Error("Timed out waiting for the turn to park again"));
    }, 10_000);
    try {
      await finished.promise;
    } finally {
      clearTimeout(timeout);
    }
  } catch (e) {
    unsubscribe();
    throw e;
  }
}

async function bootSession(queue: CompilerQueueItem[]) {
  const transport = new LocalTransport();
  const { runCompiler, calls } = makeRunCompiler(queue);
  const session = await bootControls.newSession(
    process.cwd(),
    { kind: "local" },
    {
      config: agentConfig,
      transport,
      runCompiler,
    },
  );
  await waitFor(currentLive);
  return { session, compilerCalls: calls };
}

async function hydrateSession(items: HistoryItem[], queue: CompilerQueueItem[]) {
  const transport = new LocalTransport();
  const { runCompiler, calls } = makeRunCompiler(queue);
  const session = createSession(process.cwd(), { kind: "local" });
  const nodes = insertHistoryItems(session, null, items, testModelJson);
  await bootControls.hydrate({
    session,
    history: nodes,
    config: agentConfig,
    transport,
    runCompiler,
  });
  await waitFor(currentLive);
  return { session, nodes, compilerCalls: calls };
}

function permissionControl(): OctoPermissionControl {
  const ui = useAppStore.getState().sessionMode;
  if (ui.mode !== "live" || ui.liveMode.permissionUi.type !== "prompt") {
    throw new Error("expected a permission prompt");
  }
  return ui.liveMode.permissionUi.control;
}

function sessionError(error: unknown): never {
  throw error instanceof Error ? error : new Error(String(error));
}

/* Tests */

describe("boot and response mirror", () => {
  it("boots a session, runs a response, and persists history exactly once", async () => {
    const { session, compilerCalls } = await bootSession([plain("boot-assistant-marker")]);

    await waitForNextTurn(() => respond("hello"));

    expect(historyRoles()).toEqual(["user", "assistant"]);
    expect(compilerCalls.length).toBe(1);
    expect(compilerCalls[0].irs.map(m => m.role)).toEqual(["user"]);

    const sessionId = session.metadata.sessionId ?? sessionError(new Error("no session id"));
    expect(dbNodeCount(sessionId)).toBe(2);
    expect(dbLlmIrCount(sessionId, "boot-assistant-marker")).toBe(1);
  });

  it("swapping sessions aborts the old trajectory, resets buffers, and keeps the model override", async () => {
    const first = await bootSession([plain("first-assistant-marker")]);
    await waitForNextTurn(() => respond("hi"));

    const firstLive = currentLive();
    if (firstLive == null) throw new Error("expected live session");
    const firstTrajectory = firstLive.trajectory.instance;
    const noncesBefore = {
      clear: useAppStore.getState().clearNonce,
      hydration: useAppStore.getState().sessionHydrationNonce,
    };
    useAppStore.getState().setModelOverride(agentConfig.models[0]);
    useAppStore.getState().openMenu();

    const second = await bootSession([plain("second")]);

    expect(firstTrajectory.mode.mode).toBe("aborted");
    expect(useAppStore.getState().isMenuOpen).toBe(false);
    expect(useAppStore.getState().history).toHaveLength(0);
    expect(useAppStore.getState().query).toBe("");
    expect(useAppStore.getState().modelOverride).toBe(agentModelJson);
    expect(useAppStore.getState().clearNonce).toBeGreaterThan(noncesBefore.clear);
    expect(useAppStore.getState().sessionHydrationNonce).toBeGreaterThan(noncesBefore.hydration);

    await waitForNextTurn(() => respond("again"));
    expect(historyRoles()).toEqual(["user", "assistant"]);
    const secondId = second.session.metadata.sessionId!;
    const firstId = first.session.metadata.sessionId!;
    expect(secondId).not.toBe(firstId);
    expect(dbLlmIrCount(firstId, "first-assistant-marker")).toBe(1);
  });
});

describe("permission gate mirror", () => {
  it("parks on the gate with the input hidden, allows, and persists the run exactly once", async () => {
    const callA = shellCall("call_a", "echo echo-permission-marker");
    const { session } = await bootSession([
      () => okResult(assistantMessage({ toolCalls: [callA] })),
      plain("permission-final-marker"),
    ]);

    await respond("run it");
    const prompt = await waitPermissionUi("prompt");

    const live = currentLive()!;
    expect(live.liveMode.trajectoryMode.mode).toBe("tool-call-permission");
    expect(inputFieldAvailable(live.liveMode.trajectoryMode, live.liveMode.permissionUi)).toBe(
      false,
    );
    expect(permissionControl().toolCall.toolCallId).toBe("call_a");
    await waitForNextTurn(() => prompt.control.allow());

    expect(historyRoles()).toEqual(["user", "assistant", "tool-output", "assistant"]);
    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({ call_a: 1 });
    expect(currentLive()!.liveMode.permissionUi.type).toBe("idle");
    const parked = currentLive()!;
    expect(inputFieldAvailable(parked.liveMode.trajectoryMode, parked.liveMode.permissionUi)).toBe(
      true,
    );

    const sessionId = session.metadata.sessionId!;
    expect(dbNodeCount(sessionId)).toBe(4);
    expect(dbLlmIrCount(sessionId, "echo-permission-marker")).toBe(2); // request + output, once each
    expect(dbLlmIrCount(sessionId, "permission-final-marker")).toBe(1);
  });

  it("mirrors rejection: input returns while steering, and the steering is persisted exactly once", async () => {
    const callA = shellCall("call_a", "echo a");
    const callB = shellCall("call_b", "echo b");
    const { session } = await bootSession([
      () => okResult(assistantMessage({ toolCalls: [callA, callB] })),
      plain("reject-final-marker"),
    ]);

    await respond("run both");
    const prompt = await waitPermissionUi("prompt");
    prompt.control.beginReject();

    const awaiting = await waitPermissionUi("awaiting-steering");
    const live = currentLive()!;
    expect(inputFieldAvailable(live.liveMode.trajectoryMode, live.liveMode.permissionUi)).toBe(
      true,
    );

    await waitForNextTurn(() =>
      awaiting.rejectionTx.commitRejection([{ type: "text", content: "steering-reject-marker" }]),
    );

    expect(historyRoles()).toEqual([
      "user",
      "assistant",
      "tool-reject",
      "tool-skip-output",
      "user",
      "assistant",
    ]);
    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({
      call_a: 1,
      call_b: 1,
    });
    expect(currentLive()!.liveMode.permissionUi.type).toBe("idle");

    const sessionId = session.metadata.sessionId!;
    expect(dbLlmIrCount(sessionId, "steering-reject-marker")).toBe(1);
    expect(dbLlmIrCount(sessionId, "reject-final-marker")).toBe(1);
  });

  it("whitelisting auto-allows later batches of the same tool without prompting", async () => {
    const callA = shellCall("call_a", "echo a");
    const callB = shellCall("call_b", "echo b");
    const { session } = await bootSession([
      () => okResult(assistantMessage({ toolCalls: [callA] })),
      plain("first done"),
      () => okResult(assistantMessage({ toolCalls: [callB] })),
      plain("second done"),
    ]);

    await respond("run one");
    const prompt = await waitPermissionUi("prompt");
    await waitForNextTurn(() => prompt.control.allowAndWhitelist());

    expect(useAppStore.getState().whitelistState.has("shell:*")).toBe(true);

    // If the whitelist didn't apply, the gate parks forever and this times out.
    await waitForNextTurn(() => respond("run another"));

    expect(historyRoles()).toEqual([
      "user",
      "assistant",
      "tool-output",
      "assistant",
      "user",
      "assistant",
      "tool-output",
      "assistant",
    ]);
    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({
      call_a: 1,
      call_b: 1,
    });
    const sessionId = session.metadata.sessionId!;
    expect(dbNodeCount(sessionId)).toBe(8);
  });

  it("interrupting at the gate persists skip markers so no tool call dangles", async () => {
    const callA = shellCall("call_a", "echo a");
    const callB = shellCall("call_b", "echo b");
    await bootSession([() => okResult(assistantMessage({ toolCalls: [callA, callB] }))]);

    await respond("run both");
    (await waitPermissionUi("prompt")).control.allow();

    // Wait specifically for call_b's prompt: the mirror may still show call_a's park.
    await waitFor(() => {
      const live = currentLive();
      if (live == null) return null;
      const ui = live.liveMode.permissionUi;
      return ui.type === "prompt" && ui.control.toolCall.toolCallId === "call_b" ? ui : null;
    });
    const parked = await waitTrajectoryMode("tool-call-permission");
    await waitForNextTurn(() => parked.control.interrupt());

    expect(historyRoles()).toEqual(["user", "assistant", "tool-output", "tool-skip-output"]);
    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);
  });

  it("exiting mid-run skip-marks and persists every unanswered call", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-state-test-"));
    tempDirs.push(dir);
    const marker = path.join(dir, "started");

    const callA = shellCall("call_a", `touch ${marker} && sleep 30`);
    const callB = shellCall("call_b", "echo b");
    const { session } = await bootSession([
      () => okResult(assistantMessage({ toolCalls: [callA, callB] })),
    ]);

    await respond("run both");
    (await waitPermissionUi("prompt")).control.allow();
    await waitFor(() => existsSync(marker));

    // The menu-quit / double-Ctrl-C path: the process can't wait for the running tool to
    // settle, so exit skip-marks every unanswered call before run() resolves.
    const live = currentLive()!;
    live.trajectory.exitController.abort();
    await live.trajectory.runPromise;

    expect(currentLive()!.liveMode.trajectoryMode.mode).toBe("aborted");
    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);
    expect(historyRoles()).toEqual(["user", "assistant", "tool-skip-output", "tool-skip-output"]);

    const sessionId = session.metadata.sessionId!;
    expect(dbLlmIrCount(sessionId, "exited while this tool was running")).toBe(1);
    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({
      call_a: 1,
      call_b: 1,
    });
  }, 30_000);
});

describe("error-mode mirrors", () => {
  it("maps a missing API key to the auth-error mode without a compiler call", async () => {
    delete process.env["OCTO_STATE_TEST_API_KEY"];
    const { compilerCalls } = await bootSession([plain("auth-after-marker")]);

    await respond("hi");
    const authError = await waitTrajectoryMode("auth-error");

    expect(compilerCalls.length).toBe(0);
    expect(authError.authError.length).toBeGreaterThan(0);

    process.env["OCTO_STATE_TEST_API_KEY"] = "test-key";
    await waitForNextTurn(() => authError.control.retry());
    expect(compilerCalls.length).toBe(1);
    expect(historyRoles()).toEqual(["user", "assistant"]);
  });

  it("mirrors a rewind: restores the prompt as the draft query and slices history", async () => {
    const seededUsage = compilerUsage(200_000, 10);
    const { compilerCalls } = await hydrateSession(
      [
        {
          type: "llm-ir",
          ir: { role: "user", content: [{ type: "text", content: "original prompt" }] },
        },
        { type: "llm-ir", ir: assistantMessage({ content: "seeded answer", usage: seededUsage }) },
      ],
      [
        // The seeded assistant's usage trips autocompaction; an empty summary fails it.
        () => okResult(assistantMessage({ content: "" })),
        // After the rewind, the seeded usage trips autocompaction again on the edited request.
        plain("rewind-summary-marker"),
        plain("edited-response-marker"),
      ],
    );

    const nonceAfterHydrate = useAppStore.getState().clearNonce;
    await respond("new question");
    const compactionError = await waitTrajectoryMode("compaction-error");

    await waitForNextTurn(() => compactionError.control.rewind());

    // The rewind trims back past the failed prompt, restores it as the draft query, and leaves
    // the hydrated prefix intact.
    expect(useAppStore.getState().query).toBe("new question");
    expect(useAppStore.getState().clearNonce).toBeGreaterThan(nonceAfterHydrate);
    expect(historyRoles()).toEqual(["user", "assistant"]);

    await waitForNextTurn(() => respond("edited prompt text"));

    expect(compilerCalls.length).toBe(3);
    expect(historyRoles()).toEqual(["user", "assistant", "user", "checkpoint", "assistant"]);
    // The edited request reaches the model in the re-compaction; after it, requests lower to
    // just the checkpoint.
    const compactionRequest = compilerCalls[1].irs;
    expect(compactionRequest.map(m => m.role)).toEqual(["user", "assistant", "user", "user"]);
    const editedUser = compactionRequest[2];
    if (editedUser.role !== "user") throw new Error("impossible");
    expect(editedUser.content).toEqual([{ type: "text", content: "edited prompt text" }]);
    expect(compilerCalls[2].irs.map(m => m.role)).toEqual(["lowered-checkpoint"]);
  });

  it("degrades to the lost mode when the session's tree disappears", async () => {
    const { session } = await bootSession([plain("first")]);
    await waitForNextTurn(() => respond("hi"));
    const sessionId = session.metadata.sessionId!;

    const treeId = db().select({ id: trees.id }).from(trees).where(eq(trees.name, sessionId)).get()!
      .id;
    db().delete(treeNodes).where(eq(treeNodes.treeId, treeId)).run();
    db().delete(trees).where(eq(trees.id, treeId)).run();

    await respond("again");
    const lost = await waitFor(() => {
      const mode = useAppStore.getState().sessionMode;
      return mode.mode === "lost" ? mode : null;
    });

    expect(lost.sessionId).toBe(sessionId);
    expect(lost.sessionLostError).toContain("does not exist");
    expect(useAppStore.getState().history).toHaveLength(2);
  });
});

describe("history persistence (BUGS.md #8, #12)", () => {
  it("persists compaction and retry IRs exactly once in the same run", async () => {
    const malformed = {
      type: "malformed-tool-request" as const,
      error: "bad json",
      call: { original: { name: "shell", arguments: "{oops" } },
      toolCallId: "call_mixed",
    };
    const { session, compilerCalls } = await bootSession([
      () =>
        okResult(
          assistantMessage({
            content: "mixed-attempt-marker",
            usage: compilerUsage(200_000, 10),
            toolCalls: [malformed],
          }),
        ),
      plain("mixed-summary-marker"), // compaction summary
      plain("mixed-final-marker"),
    ]);

    await waitForNextTurn(() => respond("hi"));

    expect(compilerCalls.length).toBe(3);
    expect(historyRoles()).toEqual([
      "user",
      "assistant",
      "tool-parse-error",
      "checkpoint",
      "assistant",
    ]);
    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);

    const sessionId = session.metadata.sessionId!;
    expect(dbNodeCount(sessionId)).toBe(5);
    expect(dbLlmIrCount(sessionId, "mixed-attempt-marker")).toBe(1);
    expect(dbLlmIrCount(sessionId, "call_mixed")).toBe(2); // request + parse error, once each
    expect(dbLlmIrCount(sessionId, "mixed-summary-marker")).toBe(1);
    expect(dbLlmIrCount(sessionId, "mixed-final-marker")).toBe(1);
  });

  it("keeps a notification appended mid-run on the same branch", async () => {
    const gate = deferred();
    const { session } = await bootSession([
      async () => {
        await gate.promise;
        return okResult(assistantMessage({ content: "notify-after-marker" }));
      },
    ]);

    await respond("hi");
    await waitFor(() => useAppStore.getState().history.length === 1);
    useAppStore.getState().notify("mid-run-notify-marker");
    gate.resolve();
    await waitTrajectoryMode("ready-for-request");

    expect(historyRoles()).toEqual(["user", "notification", "assistant"]);
    const sessionId = session.metadata.sessionId!;
    expect(dbNodeCount(sessionId)).toBe(3);
    expect(dbLlmIrCount(sessionId, "notify-after-marker")).toBe(1);
  });

  it("persists the partial response exactly once when interrupted mid-stream", async () => {
    const { session } = await bootSession([
      async (onTokens, params) => {
        await onTokens("partial-stream-marker", "content");
        // Abort-aware park: the arc must see the abort after tokens were emitted.
        await new Promise<void>(resolve => {
          if (params.abortSignal.aborted) return resolve();
          params.abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        return okResult(assistantMessage({ content: "unreached-full-answer" }));
      },
    ]);

    await respond("hi");
    const responding = await waitTrajectoryMode("responding");
    await responding.control.interrupt();
    await waitTrajectoryMode("ready-for-request");

    expect(historyRoles()).toEqual(["user", "assistant"]);
    const sessionId = session.metadata.sessionId!;
    expect(dbNodeCount(sessionId)).toBe(2);
    expect(dbLlmIrCount(sessionId, "partial-stream-marker")).toBe(1);
    expect(dbLlmIrCount(sessionId, "unreached-full-answer")).toBe(0);
  });
});

describe("inputFieldAvailable", () => {
  const idle: PermissionUiState = { type: "idle" };
  const steering: PermissionUiState = {
    type: "awaiting-steering",
    rejectionTx: { commitRejection: () => {} },
  };
  const ready: TrajectoryMode<OctoAgent> = {
    root: true,
    mode: "ready-for-request",
    control: { enqueueSteering: async () => {} },
  };
  const error: TrajectoryMode<OctoAgent> = {
    root: true,
    mode: "request-error",
    requestError: "boom",
    curl: null,
    control: { retry: () => {}, rewind: async () => {} },
  };

  it("is available when ready for a request", () => {
    expect(inputFieldAvailable(ready, idle)).toBe(true);
  });

  it("is hidden while an error mode is parked, and shown again when steering a rejection", () => {
    expect(inputFieldAvailable(error, idle)).toBe(false);
    expect(inputFieldAvailable(error, steering)).toBe(true);
  });

  it("is hidden when aborted", () => {
    expect(inputFieldAvailable({ root: true, mode: "aborted" }, idle)).toBe(false);
  });
});
