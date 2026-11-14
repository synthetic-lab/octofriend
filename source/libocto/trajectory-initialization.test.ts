import { prompt } from "./system-prompt.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { t } from "structural";
import { MockTransport } from "../transports/mock.ts";
import { compilerUsage, type Compiler } from "./compilers/compiler-interface.ts";
import {
  agent as agentBuilder,
  type AgentIR,
  type AssistantMessage,
  type RequestErrorIR,
  type UserMessage,
} from "./llm-ir.ts";
import { requestSnapshot } from "./request-snapshot.ts";
import { ok } from "./result.ts";
import { ToolBuilder, type ToolCall, type ToolMap } from "./tools/tool-def.ts";
import { Trajectory, type TrajectoryEvents, type TrajectoryMode } from "./trajectory.ts";

type TestData = { calls: string[] };
const workTool = new ToolBuilder<TestData>()
  .declare({ name: "work", description: "Work", ArgumentsSchema: t.subtype({}) })
  .define(async ({ data }) => {
    expect(data.calls.at(-1)).toBe("model");
    data.calls.push("loadTools");
    return {
      run: async ({ data }) => {
        data.calls.push("tool");
        return ok({ type: "output", content: text("result") });
      },
    };
  });
const delegateChild = new ToolBuilder<TestData>()
  .declare({
    name: "delegateChild",
    description: "Delegate to child",
    ArgumentsSchema: t.subtype({}),
    subagents: ["child"],
  })
  .define(async () => ({
    run: async () => ok({ type: "invoke-subagent", name: "child", message: text("child task") }),
  }));
const delegateLeaf = new ToolBuilder<TestData>()
  .declare({
    name: "delegateLeaf",
    description: "Delegate to leaf",
    ArgumentsSchema: t.subtype({}),
    subagents: ["leaf"],
  })
  .define(async () => ({
    run: async () => ok({ type: "invoke-subagent", name: "leaf", message: text("leaf task") }),
  }));
const testPrompt = prompt.declare(async () => "Test prompt");

const leaf = agentBuilder.definePermissioned({
  systemPrompt: testPrompt,
  tools: { work: workTool },
  agents: {},
});
const child = agentBuilder.definePermissioned({
  systemPrompt: testPrompt,
  tools: { work: workTool, delegateLeaf },
  agents: { leaf },
});
const agent = agentBuilder.definePermissioned({
  systemPrompt: testPrompt,
  tools: { work: workTool, delegateChild },
  agents: { child },
});
type TestAgent = typeof agent;
type TestIR = AgentIR<TestAgent>;
type TestTrajectory = Trajectory<TestAgent, null>;

function text(content: string): UserMessage["content"] {
  return [{ type: "text", content }];
}
const user: UserMessage = { role: "user", content: text("task") };
const requestError: RequestErrorIR = {
  role: "request-error",
  requestError: "failed",
  curl: "curl",
};
const workCall: ToolCall<typeof leaf.tools> = {
  type: "tool-call",
  name: "work",
  toolCallId: "work",
  original: {},
  parsed: {},
};
const childCall: ToolCall<TestAgent["tools"]> = {
  type: "tool-call",
  name: "delegateChild",
  toolCallId: "child",
  original: {},
  parsed: {},
};
const leafCall: ToolCall<typeof child.tools> = {
  type: "tool-call",
  name: "delegateLeaf",
  toolCallId: "leaf",
  original: {},
  parsed: {},
};
function assistant<Tools extends ToolMap<any, any>>(
  toolCalls?: Array<ToolCall<Tools>>,
): AssistantMessage<Tools> {
  return { role: "assistant", content: "done", usage: compilerUsage(1, 1), toolCalls };
}
function invocationHistory(): TestIR[] {
  return [
    user,
    assistant([childCall, workCall]),
    { role: "tool-invoke-subagent", subagent: "child", toolCall: childCall, message: text("task") },
  ];
}
function childHistory(irs: Array<AgentIR<typeof child>>): TestIR[] {
  return [
    ...invocationHistory(),
    {
      role: "subagent-trajectory",
      subagent: "child",
      toolCall: childCall,
      task: text("task"),
      ir: irs,
    },
  ];
}
function nestedHistory(): TestIR[] {
  return childHistory([
    user,
    assistant([leafCall, workCall]),
    { role: "tool-invoke-subagent", subagent: "leaf", toolCall: leafCall, message: text("task") },
    {
      role: "subagent-trajectory",
      subagent: "leaf",
      toolCall: leafCall,
      task: text("task"),
      ir: [user, assistant([workCall])],
    },
  ]);
}

const exits: AbortController[] = [];
const steps: Promise<boolean>[] = [];
afterEach(async () => {
  for (const exit of exits.splice(0)) exit.abort();
  await Promise.all(steps.splice(0));
});
function step(trajectory: TestTrajectory) {
  const pending = trajectory.step();
  steps.push(pending);
  return pending;
}
function fixture(messages: TestIR[], exit = new AbortController()) {
  exits.push(exit);
  const calls: string[] = [];
  const commits: Array<TrajectoryEvents<TestAgent>["onMessages"]> = [];
  const modes: Array<TrajectoryMode<TestAgent>> = [];
  const interruptions: Array<TrajectoryEvents<TestAgent>["interrupted"]> = [];
  const rewinds: Array<TrajectoryEvents<TestAgent>["rewind"]> = [];
  const ready = Promise.withResolvers<void>();
  const runCompiler: Compiler<null> = async params => {
    calls.push("compiler");
    expect(params.abortSignal.aborted).toBe(false);
    return ok({
      output: { role: "assistant", content: "done", usage: compilerUsage(1, 1) },
      curl: "curl",
      headers: new Headers(),
      usage: compilerUsage(1, 1),
    });
  };
  const transport = new MockTransport({});
  const trajectory = new Trajectory({
    agent,
    messages,
    abortSignal: exit.signal,
    transport,
    getData: async () => ({ calls }),
    model: async () => {
      calls.push("model");
      return ok({ provider: null, model: "test-model", contextWindow: 100_000, modalities: null });
    },
    runCompiler,
    lowerMessages: irs => irs.map(original => ({ original, converted: original })),
    toolContentTooLargeError: async () => "Too large",
    permission: async () => {
      calls.push("permission");
      return { decision: "allow" };
    },
    handler: {
      onMessages: event => {
        commits.push(event);
      },
      modeChange: ({ mode }) => {
        modes.push(mode);
        if (mode.mode === "ready-for-request") ready.resolve();
      },
      interrupted: event => {
        interruptions.push(event);
      },
      rewind: event => {
        rewinds.push(event);
      },
      requestRetry: () => {
        calls.push("retry");
      },
      startCompaction: () => {
        calls.push("compaction");
      },
    },
  });
  return { trajectory, calls, commits, modes, interruptions, rewinds, ready, exit };
}

const initialCases: Array<{
  name: string;
  messages: () => TestIR[];
  mode: TrajectoryMode<TestAgent>["mode"];
}> = [
  { name: "empty history", messages: () => [], mode: "ready-for-request" },
  { name: "completed response", messages: () => [user, assistant()], mode: "ready-for-request" },
  { name: "pending response", messages: () => [user], mode: "responding" },
  {
    name: "checkpoint",
    messages: () => [user, { role: "checkpoint", content: text("summary") }],
    mode: "responding",
  },
  {
    name: "pending tools",
    messages: () => [user, assistant([workCall])],
    mode: "tool-call",
  },
  { name: "pending delegation", messages: invocationHistory, mode: "tool-call" },
  { name: "request error", messages: () => [user, requestError], mode: "request-error" },
  {
    name: "compaction error",
    messages: () => [user, { ...requestError, role: "compaction-error" }],
    mode: "compaction-error",
  },
  {
    name: "auth error",
    messages: () => [user, { role: "auth-error", authError: "key" }],
    mode: "auth-error",
  },
  {
    name: "payment error",
    messages: () => [user, { role: "payment-error", requestError: "payment" }],
    mode: "payment-error",
  },
  {
    name: "rate limit",
    messages: () => [user, { role: "rate-limit-error", requestError: "limit" }],
    mode: "rate-limit-error",
  },
  ...[0, 1].map(requestBudget => {
    return {
      name: `saved request budget ${requestBudget}`,
      messages: (): TestIR[] => {
        return [
          user,
          ...requestSnapshot([requestError], { validation: null, requestError: requestBudget }),
        ];
      },
      mode: requestBudget === 0 ? ("request-error" as const) : ("responding" as const),
    };
  }),
  ...[0, 1].map(validation => {
    return {
      name: `saved validation budget ${validation}`,
      messages: (): TestIR[] => {
        const failed: TestIR[] = [
          assistant([workCall]),
          { role: "tool-validation-error", toolCall: workCall, error: "invalid", aborted: false },
        ];
        return [user, ...requestSnapshot(failed, { validation, requestError: 0 })];
      },
      mode: validation === 0 ? ("request-error" as const) : ("responding" as const),
    };
  }),
];

describe("trajectory initialization", () => {
  for (const testCase of initialCases) {
    it(`initializes ${testCase.name} without executing or publishing`, () => {
      const messages = testCase.messages();
      const saved = JSON.stringify(messages);
      const { trajectory, calls, commits, modes } = fixture(messages);
      expect(trajectory.mode.mode).toBe(testCase.mode);
      expect(trajectory.mode.root).toBe(true);
      if (trajectory.mode.mode === "responding") expect(trajectory.mode.receivedTokens).toBe(false);
      expect(JSON.stringify(trajectory.messages)).toBe(saved);
      expect(calls).toEqual([]);
      expect(commits).toEqual([]);
      expect(modes).toEqual([]);
    });
  }

  it("exposes only unanswered calls, including an unstarted delegation in its parent scope", () => {
    const { trajectory } = fixture([
      user,
      assistant([workCall, childCall]),
      { role: "tool-output", toolCall: workCall, content: text("done") },
      {
        role: "tool-invoke-subagent",
        subagent: "child",
        toolCall: childCall,
        message: text("task"),
      },
    ]);
    const mode = trajectory.mode;
    if (mode.mode !== "tool-call") throw new Error("Expected pending tool work");
    expect(mode.root).toBe(true);
    expect(mode.toolCalls).toEqual([childCall]);
    expect(mode.toolCalls[0]).toBe(childCall);
  });

  it("initializes the deepest unfinished child's scope without inserting or executing children", () => {
    const messages = nestedHistory();
    const saved = JSON.stringify(messages);
    const { trajectory, calls, commits } = fixture(messages);
    const mode = trajectory.mode;
    if (mode.mode !== "tool-call" || mode.root) throw new Error("Expected child tool work");
    expect(mode.subagent).toBe("leaf");
    expect(mode.scope.path).toEqual([
      { subagent: "child", toolCallId: "child" },
      { subagent: "leaf", toolCallId: "leaf" },
    ]);
    expect(mode.toolCalls).toEqual([workCall]);
    expect(JSON.stringify(trajectory.messages)).toBe(saved);
    expect(calls).toEqual([]);
    expect(commits).toEqual([]);
  });

  it("initializes retryable child work but returns exhausted child failures to the parent", () => {
    for (const requestBudget of [0, 1]) {
      const { trajectory, calls } = fixture(
        childHistory([
          user,
          ...requestSnapshot([requestError], { validation: null, requestError: requestBudget }),
        ]),
      );
      const mode = trajectory.mode;
      if (requestBudget === 0) {
        expect(mode.root).toBe(true);
        if (mode.mode !== "tool-call") throw new Error("Expected pending parent tool");
        expect(mode.toolCalls).toEqual([workCall]);
      } else {
        expect(mode.mode).toBe("responding");
        if (mode.root) throw new Error("Expected child retry");
        expect(mode.subagent).toBe("child");
      }
      expect(calls).toEqual([]);
    }
  });

  for (const alreadyAborted of [false, true]) {
    it(`preserves history when quit ${alreadyAborted ? "precedes construction" : "precedes the first step"}`, async () => {
      const exit = new AbortController();
      if (alreadyAborted) exit.abort();
      const messages = nestedHistory();
      const saved = JSON.stringify(messages);
      const { trajectory, calls, commits } = fixture(messages, exit);
      if (alreadyAborted) expect(trajectory.mode.mode).toBe("aborted");
      else exit.abort();
      await trajectory.run();
      expect(trajectory.mode.mode).toBe("aborted");
      expect(await step(trajectory)).toBe(false);
      expect(JSON.stringify(trajectory.messages)).toBe(saved);
      expect(calls).toEqual([]);
      expect(commits).toEqual([]);
    });
  }
});

describe("prestart controls", () => {
  for (const testCase of initialCases.filter(testCase => testCase.mode.endsWith("error"))) {
    it(`retains a prestart retry decision for ${testCase.name}`, async () => {
      const { trajectory, calls, commits } = fixture(testCase.messages());
      const mode = trajectory.mode;
      if (!("control" in mode) || !("retry" in mode.control)) throw new Error("Expected retry");
      mode.control.retry();
      if ("rewind" in mode.control) await mode.control.rewind();
      expect(commits).toEqual([]);
      expect(calls).toEqual([]);
      await step(trajectory);
      expect(commits[0]?.irs).toEqual([{ role: "error-retry" }]);
      expect(calls.filter(call => call === "compiler")).toHaveLength(1);
    });
  }

  it("retains root auth clear before startup and waits for new input", async () => {
    const { trajectory, calls, commits, ready } = fixture([
      user,
      { role: "auth-error", authError: "key" },
    ]);
    const mode = trajectory.mode;
    if (mode.mode !== "auth-error") throw new Error("Expected auth error");
    mode.control.clear();
    expect(commits).toEqual([]);
    const pending = step(trajectory);
    await ready.promise;
    expect(calls).toEqual([]);
    expect(commits[0]?.irs).toEqual([{ role: "error-dismissed" }]);
    const current = trajectory.mode;
    if (current.mode !== "ready-for-request") throw new Error("Expected input");
    await current.control.enqueueSteering(text("new task"));
    await pending;
    expect(calls.filter(call => call === "compiler")).toHaveLength(1);
  });

  for (const inChild of [false, true]) {
    it(`does not abandon pending ${inChild ? "child" : "root"} tools when auth is cleared before startup`, async () => {
      const messages: Array<AgentIR<typeof leaf>> = [
        user,
        assistant([workCall]),
        { role: "auth-error", authError: "key" },
      ];
      const { trajectory, calls, commits } = fixture(inChild ? childHistory(messages) : messages);
      const mode = trajectory.mode;
      if (mode.mode !== "auth-error") throw new Error("Expected auth error");
      expect(mode.root).toBe(!inChild);
      mode.control.clear();
      await step(trajectory);
      expect(commits[0]?.irs).toEqual([{ role: "error-retry" }]);
      expect(calls.filter(call => call === "tool")).toHaveLength(1);
      expect(calls.filter(call => call === "compiler")).toHaveLength(1);
    });
  }

  it("rewinds before startup without leaving a stale error decision for the first step", async () => {
    const { trajectory, calls, ready, rewinds } = fixture([assistant(), user, requestError]);
    const mode = trajectory.mode;
    if (mode.mode !== "request-error") throw new Error("Expected request error");
    await mode.control.rewind();
    expect(trajectory.messages).toEqual([assistant()]);
    expect(rewinds[0]?.content).toEqual(user.content);
    const pending = step(trajectory);
    await ready.promise;
    expect(calls).toEqual([]);
    const current = trajectory.mode;
    if (current.mode !== "ready-for-request") throw new Error("Expected input");
    await current.control.enqueueSteering(text("revised task"));
    await pending;
    expect(calls.filter(call => call === "compiler")).toHaveLength(1);
  });

  for (const [name, history] of [
    ["response", () => [user]],
    ["tools", () => [user, assistant([workCall])]],
    ["invocation", invocationHistory],
    ["nested child", nestedHistory],
  ] satisfies Array<[string, () => TestIR[]]>) {
    it(`interrupts prestart ${name} without runtime work and accepts a later turn`, async () => {
      const messages = history();
      const saved = JSON.stringify(messages);
      const { trajectory, calls, commits, interruptions } = fixture(messages);
      const mode = trajectory.mode;
      if (!("control" in mode) || !("interrupt" in mode.control))
        throw new Error("Expected interrupt");
      await mode.control.enqueueSteering(text("queued"));
      await mode.control.interrupt();
      expect(interruptions).toEqual([{ droppedSteering: [text("queued")] }]);
      expect(JSON.stringify(trajectory.messages)).toBe(saved);
      expect(commits).toEqual([]);
      expect(await step(trajectory)).toBe(true);
      expect(calls).toEqual([]);
      expect(commits.some(event => event.irs.some(ir => ir.role === "subagent-trajectory"))).toBe(
        false,
      );
      const current = trajectory.mode;
      if (current.mode !== "ready-for-request")
        throw new Error("Expected input after interruption");
      expect(commits.length).toBeGreaterThan(0);
      const reloaded = fixture(JSON.parse(JSON.stringify(trajectory.messages)));
      expect(reloaded.trajectory.mode.mode).toBe("ready-for-request");
      expect(reloaded.calls).toEqual([]);
      await current.control.enqueueSteering(text("new task"));
      await step(trajectory);
      expect(calls.filter(call => call === "compiler")).toHaveLength(1);
      expect(calls).not.toContain("tool");
      expect(calls).not.toContain("permission");
    });
  }
});
