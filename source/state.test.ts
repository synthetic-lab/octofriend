import { existsSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "./state.ts";
import type { Config } from "./config.ts";
import type { HistoryNode } from "./session-history/index.ts";
import { createSession, insertHistoryItems } from "./session-history/index.ts";
import { compilerUsage } from "./libocto/compilers/compiler-interface.ts";
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

const tempDirs: string[] = [];

beforeEach(() => {
  useAppStore.setState({
    history: [],
    preMenuModeData: null,
    lastUserPromptIndex: null,
    modeData: { mode: "input", vimMode: "INSERT" },
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
  const nodes = insertHistoryItems(session, null, [
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
  ]);
  useAppStore.getState().hydrateSession(nodes);
  const abortController = new AbortController();
  useAppStore.setState({
    modeData: {
      mode: "tool-call",
      toolReqs: [callA, callB],
      runningToolCallId: null,
      abortController,
    },
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
    useAppStore.getState().abortResponse(session);

    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);
    expect(useAppStore.getState().modeData.mode).toBe("input");
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
    useAppStore.getState().abortResponse(session);
    await running;

    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);
    expect(useAppStore.getState().modeData.mode).toBe("input");
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
    useAppStore.getState().abortResponse(session, { exiting: true });
    expect(unansweredToolCallIds(useAppStore.getState().history)).toEqual([]);

    await running;
  }, 30_000);
});
