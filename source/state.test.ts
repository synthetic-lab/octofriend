import { existsSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore, nextToolAction } from "./state.ts";
import type { Config } from "./config.ts";
import type { HistoryNode } from "./session-history/index.ts";
import { createSession, insertHistoryItems } from "./session-history/index.ts";
import { serializeModelJson } from "./session-history/model-json.ts";
import { compilerUsage } from "./libocto/compilers/compiler-interface.ts";
import { answeredToolCallId } from "./libocto/llm-ir.ts";
import type { ToolCall } from "./libocto/tool-def.ts";
import type toolMap from "./tools/tool-defs/index.ts";
import { LocalTransport } from "./transports/local.ts";

/*
 * Regression tests for BUGS.md #2: aborting a multi-tool batch must not leave dangling tool
 * calls in history.
 *
 * Every tool call in an assistant message must be answered by a tool-output-shaped IR. Anthropic
 * hard-400s on unanswered `tool_use` blocks, and while the chat-completions spec tolerates
 * missing outputs, a call with no result is confusing and out-of-distribution for models.
 * Today, ESC during a tool batch silently drops every request after the currently-running one.
 */

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

const testModelJson = serializeModelJson(config.models[0]);

const tempDirs: string[] = [];

beforeEach(() => {
  useAppStore.setState({
    history: [],
    preMenuModeData: null,
    lastUserPromptIndex: null,
    runningToolCallId: null,
    queuedUserMessages: [],
    modeData: { mode: "ready-for-request" },
    vimMode: "INSERT",
  });
});

afterEach(async () => {
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
    if (
      ir.role === "tool-output" ||
      ir.role === "tool-skip-output" ||
      ir.role === "tool-runtime-error" ||
      ir.role === "tool-validation-error" ||
      ir.role === "tool-reject"
    ) {
      answered.add(ir.toolCall.toolCallId);
      continue;
    }
    if (ir.role === "tool-parse-error") {
      answered.add(ir.malformedRequest.toolCallId);
      continue;
    }
    if (ir.role === "file-read" || ir.role === "file-mutate") {
      answered.add(ir.toolCall.toolCallId);
    }
  }
  return requested.filter(id => !answered.has(id));
}

async function waitFor(cond: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

function setupToolBatch(callA: ShellToolCall, callB: ShellToolCall) {
  const session = createSession(process.cwd(), { kind: "local" });
  const nodes = insertHistoryItems(
    session,
    null,
    [
      {
        type: "llm-ir",
        ir: {
          role: "user",
          content: [{ type: "text", content: "Run these two commands" }],
        },
      },
      {
        type: "llm-ir",
        ir: {
          role: "assistant",
          content: "On it.",
          usage: compilerUsage(0, 0),
          toolCalls: [callA, callB],
        },
      },
    ],
    testModelJson,
  );
  useAppStore.getState().hydrateSession(nodes);
  const abortController = new AbortController();
  useAppStore.setState({
    modeData: {
      mode: "tool-call",
      toolReqs: [callA, callB],
      abortController,
    },
    runningToolCallId: null,
  });
  return { session, abortController };
}

describe("aborting a tool batch", () => {
  it("marks pending tool calls as answered when aborting between tool calls", async () => {
    const transport = new LocalTransport();
    const callA = shellCall("call_a", "echo a");
    const callB = shellCall("call_b", "echo b");
    const { session } = setupToolBatch(callA, callB);

    await useAppStore.getState().runTool({ config, transport, session, toolReq: callA });

    // The user presses ESC while call_b is still pending. The UI drops the remaining requests
    // (ToolRequestsRenderer unmounts), so the store must record that call_b never ran —
    // otherwise the next request sends an assistant message with an unanswered tool call.
    useAppStore.getState().abortResponse(session, config);

    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);
    expect(useAppStore.getState().modeData.mode).toBe("ready-for-request");
  });

  it("marks pending tool calls as answered when aborting a running tool", async () => {
    const transport = new LocalTransport();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-state-test-"));
    tempDirs.push(dir);
    const marker = path.join(dir, "started");

    const callA = shellCall("call_a", `touch ${marker} && sleep 30`);
    const callB = shellCall("call_b", "echo b");
    const { session } = setupToolBatch(callA, callB);

    const running = useAppStore.getState().runTool({ config, transport, session, toolReq: callA });

    // Wait for the shell command to actually start, then ESC mid-run.
    await waitFor(() => existsSync(marker));
    useAppStore.getState().abortResponse(session, config);
    await running;

    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);
    expect(useAppStore.getState().modeData.mode).toBe("ready-for-request");
  }, 30_000);

  it("marks even the running tool call as answered when exiting", async () => {
    const transport = new LocalTransport();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-state-test-"));
    tempDirs.push(dir);
    const marker = path.join(dir, "started");

    const callA = shellCall("call_a", `touch ${marker} && sleep 30`);
    const callB = shellCall("call_b", "echo b");
    const { session } = setupToolBatch(callA, callB);

    const running = useAppStore.getState().runTool({ config, transport, session, toolReq: callA });
    await waitFor(() => existsSync(marker));

    /*
     * On exit (double Ctrl+C, menu quit) the process can't wait for the running tool to
     * settle, so the store must synchronously mark every unanswered call as skipped —
     * including the running one. Assert before `running` resolves.
     */
    useAppStore.getState().abortResponse(session, config, { exiting: true });
    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);

    await running;
  }, 30_000);
});

/*
 * Regression tests for BUGS.md #1: opening and closing the menu mid-tool-batch unmounts and
 * remounts ToolRequestsRenderer, which must not re-run already-executed (or in-flight) tools.
 * The renderer derives its behavior from nextToolAction; these tests pin that derivation.
 */

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

function assistantNode(calls: ShellToolCall[], nodeId: number): HistoryNode {
  return {
    type: "llm-ir",
    nodeId,
    modelJson: testModelJson,
    ir: {
      role: "assistant",
      content: "On it.",
      usage: compilerUsage(0, 0),
      toolCalls: calls,
    },
  };
}

function toolOutputNode(call: ShellToolCall, nodeId: number): HistoryNode {
  return {
    type: "llm-ir",
    nodeId,
    modelJson: testModelJson,
    ir: {
      role: "tool-output",
      toolCall: call,
      content: [{ type: "text", content: "done" }],
    },
  };
}

describe("nextToolAction", () => {
  const callA = shellCall("call_a", "echo a");
  const callB = shellCall("call_b", "echo b");
  const batch = [callA, callB];
  const base = [assistantNode(batch, 1)];

  it("runs the first tool when nothing is answered", () => {
    expect(nextToolAction(batch, null, base)).toEqual({ kind: "ready", req: callA });
  });

  it("runs the first unanswered tool", () => {
    expect(nextToolAction(batch, null, [...base, toolOutputNode(callA, 2)])).toEqual({
      kind: "ready",
      req: callB,
    });
  });

  it("is done when every tool is answered", () => {
    const history = [...base, toolOutputNode(callA, 2), toolOutputNode(callB, 3)];
    expect(nextToolAction(batch, null, history)).toEqual({ kind: "done" });
  });

  it("waits for the in-flight tool rather than re-running it", () => {
    expect(nextToolAction(batch, "call_a", base)).toEqual({ kind: "in-flight", req: callA });
  });

  it("ignores a stale running ID for an already-answered tool", () => {
    expect(nextToolAction(batch, "call_a", [...base, toolOutputNode(callA, 2)])).toEqual({
      kind: "ready",
      req: callB,
    });
  });

  it("treats tool-skip-output as answered", () => {
    const history: HistoryNode[] = [
      ...base,
      {
        type: "llm-ir",
        nodeId: 2,
        modelJson: testModelJson,
        ir: { role: "tool-skip-output", toolCall: callA, reason: "skipped" },
      },
    ];
    expect(nextToolAction(batch, null, history)).toEqual({ kind: "ready", req: callB });
  });
});

/*
 * Regression tests: tool call IDs are only unique within a single response. Some providers
 * recycle IDs across turns (e.g. per-response counters like call_0), and provider-generated IDs
 * must never be rewritten — LLMs misbehave when handed IDs they didn't generate. Answered-ness
 * must therefore be derived relative to the current batch's request message, not the whole
 * session history, or a new batch whose IDs collide with an earlier batch is instantly treated
 * as done: tools never run, never render, and the model is handed the stale output.
 */
describe("tool call IDs reused across batches", () => {
  const firstBatchCall = shellCall("call_0", "echo first");
  const secondBatchCall = shellCall("call_0", "echo second");

  const historyWithAnsweredFirstBatch: HistoryNode[] = [
    assistantNode([firstBatchCall], 1),
    toolOutputNode(firstBatchCall, 2),
    assistantNode([secondBatchCall], 3),
  ];

  it("runs a new batch whose IDs collide with an earlier answered batch", () => {
    expect(nextToolAction([secondBatchCall], null, historyWithAnsweredFirstBatch)).toEqual({
      kind: "ready",
      req: secondBatchCall,
    });
  });

  it("is done only once the new batch is itself answered", () => {
    const history = [...historyWithAnsweredFirstBatch, toolOutputNode(secondBatchCall, 4)];
    expect(nextToolAction([secondBatchCall], null, history)).toEqual({ kind: "done" });
  });

  it("runs a colliding tool call to completion", async () => {
    const transport = new LocalTransport();
    const session = createSession(process.cwd(), { kind: "local" });
    const nodes = insertHistoryItems(
      session,
      null,
      [
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "First.",
            usage: compilerUsage(0, 0),
            toolCalls: [firstBatchCall],
          },
        },
        {
          type: "llm-ir",
          ir: {
            role: "tool-output",
            toolCall: firstBatchCall,
            content: [{ type: "text", content: "first" }],
          },
        },
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "Second.",
            usage: compilerUsage(0, 0),
            toolCalls: [secondBatchCall],
          },
        },
      ],
      testModelJson,
    );
    useAppStore.getState().hydrateSession(nodes);
    useAppStore.setState({
      modeData: {
        mode: "tool-call",
        toolReqs: [secondBatchCall],
        abortController: new AbortController(),
      },
      runningToolCallId: null,
    });

    await useAppStore.getState().runTool({ config, transport, session, toolReq: secondBatchCall });

    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({ call_0: 2 });
    const state = useAppStore.getState();
    expect(nextToolAction([secondBatchCall], state.runningToolCallId, state.history)).toEqual({
      kind: "done",
    });
  });

  it("rejects and skips within the current batch when IDs collide with an earlier batch", () => {
    const session = createSession(process.cwd(), { kind: "local" });
    const secondBatchSecondCall = shellCall("call_1", "echo later");
    const nodes = insertHistoryItems(
      session,
      null,
      [
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "First.",
            usage: compilerUsage(0, 0),
            toolCalls: [firstBatchCall],
          },
        },
        {
          type: "llm-ir",
          ir: {
            role: "tool-output",
            toolCall: firstBatchCall,
            content: [{ type: "text", content: "first" }],
          },
        },
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "Second.",
            usage: compilerUsage(0, 0),
            toolCalls: [secondBatchCall, secondBatchSecondCall],
          },
        },
      ],
      testModelJson,
    );
    useAppStore.getState().hydrateSession(nodes);
    useAppStore.setState({
      modeData: {
        mode: "tool-call",
        toolReqs: [secondBatchCall, secondBatchSecondCall],
        abortController: new AbortController(),
      },
      runningToolCallId: null,
    });

    // Rejecting the first call of the new batch must reject *this* batch's call_0 and skip only
    // this batch's remaining call — the earlier batch's answered call_0 must not confuse it.
    useAppStore.getState().rejectTool(secondBatchCall, session, config);

    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({
      call_0: 2, // earlier output + this batch's reject marker
      call_1: 1, // this batch's skip marker
    });
    expect(useAppStore.getState().modeData.mode).toBe("input");
  });

  it("marks colliding calls as skipped on abort rather than treating them as answered", () => {
    const session = createSession(process.cwd(), { kind: "local" });
    const nodes = insertHistoryItems(
      session,
      null,
      [
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "First.",
            usage: compilerUsage(0, 0),
            toolCalls: [firstBatchCall],
          },
        },
        {
          type: "llm-ir",
          ir: {
            role: "tool-output",
            toolCall: firstBatchCall,
            content: [{ type: "text", content: "first" }],
          },
        },
        {
          type: "llm-ir",
          ir: {
            role: "assistant",
            content: "Second.",
            usage: compilerUsage(0, 0),
            toolCalls: [secondBatchCall],
          },
        },
      ],
      testModelJson,
    );
    useAppStore.getState().hydrateSession(nodes);
    useAppStore.setState({
      modeData: {
        mode: "tool-call",
        toolReqs: [secondBatchCall],
        abortController: new AbortController(),
      },
      runningToolCallId: null,
    });

    useAppStore.getState().abortResponse(session, config);

    // The new call_0 gets its own skip marker, not silently treated as answered by the old one:
    // otherwise the aborted batch leaves a dangling tool call that Anthropic hard-400s on.
    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({ call_0: 2 });
    expect(useAppStore.getState().modeData.mode).toBe("input");
  });
});

describe("menu round-trips during a tool batch", () => {
  it("resumes at the first unanswered tool when remounting between tools", async () => {
    const transport = new LocalTransport();
    const callA = shellCall("call_a", "echo a");
    const callB = shellCall("call_b", "echo b");
    const { session } = setupToolBatch(callA, callB);

    await useAppStore.getState().runTool({ config, transport, session, toolReq: callA });

    // Opening the menu unmounts ToolRequestsRenderer; closing it remounts. The remounted
    // renderer must resume at call_b, not re-run call_a.
    useAppStore.getState().openMenu();
    useAppStore.getState().closeMenu();

    const state = useAppStore.getState();
    if (state.modeData.mode !== "tool-call") throw new Error("expected tool-call mode");
    expect(nextToolAction(state.modeData.toolReqs, state.runningToolCallId, state.history)).toEqual(
      { kind: "ready", req: callB },
    );

    await useAppStore.getState().runTool({ config, transport, session, toolReq: callB });
    expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({
      call_a: 1,
      call_b: 1,
    });
  });

  it("waits for the in-flight tool when remounting mid-run", async () => {
    const transport = new LocalTransport();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-state-test-"));
    tempDirs.push(dir);
    const marker = path.join(dir, "started");

    const callA = shellCall("call_a", `touch ${marker} && sleep 30`);
    const callB = shellCall("call_b", "echo b");
    const { session } = setupToolBatch(callA, callB);

    const running = useAppStore.getState().runTool({ config, transport, session, toolReq: callA });
    await waitFor(() => existsSync(marker));

    useAppStore.getState().openMenu();
    useAppStore.getState().closeMenu();

    const state = useAppStore.getState();
    if (state.modeData.mode !== "tool-call") throw new Error("expected tool-call mode");
    expect(nextToolAction(state.modeData.toolReqs, state.runningToolCallId, state.history)).toEqual(
      { kind: "in-flight", req: callA },
    );

    // Clean up: abort the batch so the test doesn't wait on the sleeping tool.
    useAppStore.getState().abortResponse(session, config);
    await running;

    // Exactly one answer for the in-flight tool: it was never re-run.
    expect(answerCountsByToolCallId(useAppStore.getState().history)["call_a"]).toBe(1);
  }, 30_000);

  it("clears the running tool ID when a tool settles while the menu is open", async () => {
    const transport = new LocalTransport();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "octo-state-test-"));
    tempDirs.push(dir);
    const marker = path.join(dir, "started");

    const callA = shellCall("call_a", `touch ${marker} && sleep 0.5`);
    const callB = shellCall("call_b", "echo b");
    const { session } = setupToolBatch(callA, callB);

    const prevCanary = process.env["CANARY_OCTO"];
    process.env["CANARY_OCTO"] = "1";
    try {
      const running = useAppStore
        .getState()
        .runTool({ config, transport, session, toolReq: callA });
      await waitFor(() => existsSync(marker));
      useAppStore.getState().openMenu();
      await running; // settles while the menu is open

      // The running ID is top-level state, cleared on settle even though the tool-call
      // modeData is stashed in preMenuModeData.
      expect(useAppStore.getState().runningToolCallId).toBeNull();

      useAppStore.getState().closeMenu();
      const state = useAppStore.getState();
      if (state.modeData.mode !== "tool-call") throw new Error("expected tool-call mode");
      expect(
        nextToolAction(state.modeData.toolReqs, state.runningToolCallId, state.history),
      ).toEqual({ kind: "ready", req: callB });

      // The canary double-run guard must not fire when running the next tool.
      await useAppStore.getState().runTool({ config, transport, session, toolReq: callB });
      expect(answerCountsByToolCallId(useAppStore.getState().history)).toEqual({
        call_a: 1,
        call_b: 1,
      });
    } finally {
      if (prevCanary == null) delete process.env["CANARY_OCTO"];
      else process.env["CANARY_OCTO"] = prevCanary;
    }
  }, 30_000);
});

describe("message queue", () => {
  it("coalesces queued messages into a single user message on flush", () => {
    const session = createSession(process.cwd(), { kind: "local" });
    useAppStore.getState().enqueueUserMessage({ content: "one" });
    useAppStore.getState().enqueueUserMessage({ content: "two" });
    expect(useAppStore.getState().history).toHaveLength(0);

    useAppStore.getState()._sendQueuedUserMessages(session);

    const { history, queuedUserMessages: queuedMessages } = useAppStore.getState();
    expect(queuedMessages).toHaveLength(0);
    expect(history).toHaveLength(1);
    const item = history[0];
    if (item.type !== "llm-ir" || item.ir.role !== "user") throw new Error("expected user IR");
    expect(item.ir.content).toEqual([{ type: "text", content: "one\ntwo" }]);
  });

  it("clears the queue on abort without persisting", () => {
    const session = createSession(process.cwd(), { kind: "local" });
    useAppStore.getState().enqueueUserMessage({ content: "one" });
    useAppStore.getState().abortResponse(session);
    expect(useAppStore.getState().queuedUserMessages).toHaveLength(0);
    expect(useAppStore.getState().history).toHaveLength(0);
  });
});
