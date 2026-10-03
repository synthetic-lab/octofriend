import { beforeEach, describe, expect, it } from "bun:test";
import { t } from "structural";
import { LocalTransport } from "../transports/local.ts";
import type { Transport } from "../transports/transport-common.ts";
import type { ImageInfo } from "../utils/image-utils.ts";
import { err, ok, type Result } from "./result.ts";
import { ToolBuilder, type LoadedTools, type ToolCall, type ToolReturn } from "./tool-def.ts";
import {
  definePermissionedAgent,
  definePermissionlessAgent,
  type Agent,
  type AgentIR,
  type AssistantMessage,
  type LoweredIR,
  type PreLoweredIR,
  type UserMessage,
} from "./llm-ir.ts";
import {
  compilerUsage,
  type AutofixJsonFn,
  type Compiler,
  type CompilerError,
  type CompilerParams,
  type CompilerResult,
  type CompilerSuccessData,
} from "./compilers/compiler-interface.ts";
import type { ErrorCorrection } from "./trajectory-arc.ts";
import type { PermissionDecision } from "./permissions.ts";
import {
  Trajectory,
  type ClearControl,
  type InputControl,
  type RectifyControl,
  type RetryControl,
  type TrajectoryEvents,
  type TrajectoryLoopController,
  type TrajectoryMode,
} from "./trajectory.ts";

type TestData = { marker: string };
type RunResult = Result<ToolReturn<"research", never>, string>;

let runImpl: (query: string) => Promise<RunResult>;

const searchTool = new ToolBuilder<TestData>()
  .declare({
    name: "search",
    description: "Searches the web",
    ArgumentsSchema: t.subtype({ query: t.str }),
    subagents: ["research"] as const,
  })
  .define(async () => ({
    validate: async (_signal: AbortSignal, _transport: Transport, toolCall: any) => {
      if (toolCall.parsed.arguments.query === "invalid") return err("invalid query");
      return ok(null);
    },
    run: async ({ toolCall }: { toolCall: { parsed: { arguments: { query: string } } } }) => {
      return runImpl(toolCall.parsed.arguments.query);
    },
  }));

const shellTool = new ToolBuilder<TestData>()
  .declare({
    name: "shell",
    description: "Runs a shell command, returning custom IR",
    ArgumentsSchema: t.subtype({ command: t.str }),
  })
  .withCustomIR({
    result: toolCall => (args: { transcript: string }) => ({
      role: "shell-result" as const,
      toolCall,
      transcript: args.transcript,
    }),
  })
  .define(async () => ({
    run: async ({ customIR }: any) => customIR.result({ transcript: "ran ok" }),
  }));

const researchAgent = definePermissionlessAgent({ tools: {}, agents: {} });

const _testAgent = definePermissionedAgent({
  tools: { search: searchTool, shell: shellTool },
  agents: { research: researchAgent },
});
type TestAgent = typeof _testAgent;

const _plainAgent = definePermissionlessAgent({
  tools: { search: searchTool },
  agents: { research: researchAgent },
});

const transport: Transport = new LocalTransport();

function text(content: string): UserMessage["content"] {
  return [{ type: "text", content }];
}

function img(filePath: string): Extract<UserMessage["content"][number], { type: "image" }> {
  const image: ImageInfo = {
    mimeType: "image/png",
    base64Data: "",
    dataUrl: "",
    filePath,
    sizeBytes: 0,
  };
  return { type: "image", image };
}

function searchCall(query: string, toolCallId: string): ToolCall<TestAgent["tools"]> {
  return { type: "tool-call", name: "search", toolCallId, original: { query }, parsed: { query } };
}

function shellCall(command: string, toolCallId: string): ToolCall<TestAgent["tools"]> {
  return {
    type: "tool-call",
    name: "shell",
    toolCallId,
    original: { command },
    parsed: { command },
  };
}

function assistantMessage(opts: {
  content?: string;
  toolCalls?: Array<ToolCall<TestAgent["tools"]>>;
}): AssistantMessage<TestAgent["tools"]> {
  return {
    role: "assistant",
    content: opts.content ?? "",
    usage: compilerUsage(1, 1),
    toolCalls: opts.toolCalls,
  };
}

type Emit = (tokens: string, type: "reasoning" | "content") => void;
type CompilerQueueItemParams = { autofixJson?: AutofixJsonFn; abortSignal: AbortSignal };
type CompilerQueueItem = (
  onTokens: Emit,
  params: CompilerQueueItemParams,
) =>
  | Result<CompilerSuccessData<TestAgent>, CompilerError>
  | Promise<Result<CompilerSuccessData<TestAgent>, CompilerError>>;

function okResult(
  output: AssistantMessage<TestAgent["tools"]>,
): Result<CompilerSuccessData<TestAgent>, CompilerError> {
  return ok({ output, curl: "curl", headers: new Headers(), usage: compilerUsage(1, 1) });
}

const plainOk: CompilerQueueItem = () => okResult(assistantMessage({ content: "done" }));

function requestError(message: string): Extract<CompilerError, { type: "request-error" }> {
  return { type: "request-error", requestError: message, curl: "curl" };
}

function rateLimitError(): Extract<CompilerError, { type: "rate-limit-error" }> {
  return {
    type: "rate-limit-error",
    requestError: "slow down",
    curl: "curl",
    headers: new Headers(),
  };
}

function makeRunCompiler(queue: CompilerQueueItem[]) {
  const calls: Array<{ irs: Array<LoweredIR<any>> }> = [];
  const runCompiler: Compiler<null> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, null, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    calls.push({ irs: [...params.irs] as Array<LoweredIR<any>> });
    const next = queue.shift();
    if (next == null) throw new Error("unexpected compiler call");
    const result = await next(params.onTokens, params);
    return result as typeof result & CompilerResult<A, Tools>;
  };
  return { runCompiler, calls };
}

function makeTrajectory(opts?: {
  permission?: (toolCall: ToolCall<TestAgent["tools"]>) => Promise<PermissionDecision>;
  contextWindow?: number;
  maxToolOutput?: number;
  countTokens?: (irs: Array<LoweredIR<TestAgent["tools"]>>) => number;
  toolContentTooLargeError?: (ir: unknown) => Promise<string>;
  requestErrorRetries?: { maxRetryCount?: number; backoffMs: number; maxBackoffMs?: number };
  validationRetries?: number;
  errorCorrection?: ErrorCorrection<TestAgent>;
  loopController?: TrajectoryLoopController;
  messages?: Array<AgentIR<TestAgent>>;
  modelAuthError?: () => string | undefined;
}) {
  const rec = {
    modes: [] as Array<TrajectoryMode<TestAgent>["mode"]>,
    modeObjs: [] as Array<TrajectoryMode<TestAgent>>,
    roles: [] as string[],
    timeline: [] as string[],
    rewinds: [] as Array<TrajectoryEvents<TestAgent>["rewind"]>,
    capCalls: [] as unknown[],
    arc: {
      startResponse: 0,
      responseProgress: 0,
      onResponseHeaders: 0,
      compaction: 0,
      autofixJson: 0,
      autofixTool: 0,
      requestRetry: 0,
    },
    modelCalls: 0,
    loadToolsCalls: 0,
  };
  const exit = new AbortController();

  const build = async (queue: CompilerQueueItem[]) => {
    const [searchDef, shellDef] = await Promise.all([
      searchTool({ signal: new AbortController().signal, transport, data: { marker: "fresh" } }),
      shellTool({ signal: new AbortController().signal, transport, data: { marker: "fresh" } }),
    ]);
    if (searchDef == null || shellDef == null) throw new Error("tools failed to load");
    const { runCompiler, calls } = makeRunCompiler(queue);
    const traj = new Trajectory({
      agent: _testAgent,
      model: async () => {
        rec.modelCalls++;
        const authError = opts?.modelAuthError?.();
        if (authError != null) return err({ type: "auth-error", authError });
        return ok({ model: null, contextWindow: opts?.contextWindow ?? 10_000 });
      },
      loadTools: async () => {
        rec.loadToolsCalls++;
        return { search: searchDef, shell: shellDef };
      },
      maxToolOutput: opts?.maxToolOutput,
      countTokens: opts?.countTokens,
      toolContentTooLargeError:
        opts?.toolContentTooLargeError ??
        (async ir => {
          rec.capCalls.push(ir);
          return "OUTPUT TOO LARGE";
        }),
      requestErrorRetries: opts?.requestErrorRetries,
      validationRetries: opts?.validationRetries,
      errorCorrection: opts?.errorCorrection,
      loopController: opts?.loopController,
      messages: opts?.messages ?? [],
      toolData: { marker: "fresh" },
      runCompiler,
      subagentPrompts: { research: async () => "You are the research subagent." },
      lowerMessages: messages => {
        const preLowered: Array<PreLoweredIR<TestAgent>> = [];
        for (const ir of messages) {
          if (ir.role === "shell-result") {
            preLowered.push({
              role: "tool-output",
              toolCall: ir.toolCall,
              content: text(ir.transcript),
            });
          } else {
            // This binding is the exhaustiveness check: if the agent gains another extension
            // IR, it no longer fits PreLoweredIR and this fails to compile until converted.
            const builtin: PreLoweredIR<TestAgent> = ir;
            preLowered.push(builtin);
          }
        }
        return preLowered;
      },
      transport,
      abortSignal: exit.signal,
      permission: async toolCall => {
        return opts?.permission ? opts.permission(toolCall) : { decision: "allow" };
      },
      handler: {
        modeChange: mode => {
          rec.modes.push(mode.mode);
          rec.modeObjs.push(mode);
          rec.timeline.push(`mode:${mode.mode}`);
        },
        onMessage: ir => {
          rec.roles.push(ir.role);
          rec.timeline.push(`ir:${ir.role}`);
        },
        steeringChange: ({ upcoming, queued }) => {
          rec.timeline.push(`steering:${upcoming.length}u${queued.length}q`);
        },
        rewind: payload => {
          rec.rewinds.push(payload);
        },
        startResponse: () => {
          rec.arc.startResponse++;
        },
        responseProgress: () => {
          rec.arc.responseProgress++;
        },
        onResponseHeaders: () => {
          rec.arc.onResponseHeaders++;
        },
        startCompaction: () => {
          rec.arc.compaction++;
        },
        autofixingJson: () => {
          rec.arc.autofixJson++;
        },
        autofixingTool: () => {
          rec.arc.autofixTool++;
        },
        requestRetry: () => {
          rec.arc.requestRetry++;
        },
      },
    });
    return { traj, compilerCalls: calls };
  };
  return { build, rec, exit };
}

function inputControl<A extends Agent<any, any, any>>(traj: Trajectory<A, null>) {
  const mode = traj.mode;
  if ("control" in mode && "enqueueSteering" in mode.control) {
    return mode.control as InputControl;
  }
  throw new Error(`mode ${mode.mode} has no input control`);
}

function interruptNow(traj: Trajectory<any, null>) {
  const mode = traj.mode;
  if ("control" in mode && "interrupt" in mode.control) return mode.control.interrupt();
  throw new Error(`mode ${mode.mode} has no interrupt control`);
}

function rectifyControl(traj: Trajectory<any, null>): RectifyControl {
  const mode = traj.mode;
  if (mode.mode !== "request-error" && mode.mode !== "compaction-error") {
    throw new Error(`expected an error mode with rectify control, got ${mode.mode}`);
  }
  return mode.control;
}

function retryControl(traj: Trajectory<any, null>): RetryControl & Partial<ClearControl> {
  const mode = traj.mode;
  if (
    mode.mode !== "payment-error" &&
    mode.mode !== "rate-limit-error" &&
    mode.mode !== "auth-error"
  ) {
    throw new Error(`expected an error mode with retry control, got ${mode.mode}`);
  }
  return mode.control;
}

beforeEach(() => {
  runImpl = async query => ok({ type: "output", content: text(`results: ${query}`) });
});

describe("trajectory", () => {
  it("appends input, runs one arc, and lands ready-for-request", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant"]);
    expect(compilerCalls.length).toBe(1);
    expect(compilerCalls[0].irs.map(m => m.role)).toEqual(["user"]);
    expect(rec.modes).toEqual(["responding", "ready-for-request"]);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("coalesces multiple steering messages into one user message", async () => {
    const { build } = makeTrajectory();
    const { traj, compilerCalls } = await build([plainOk]);

    inputControl(traj).enqueueSteering(text("one"));
    inputControl(traj).enqueueSteering(text("two"));
    expect(await traj.step()).toBe(true);

    const userIr = compilerCalls[0].irs[0];
    if (userIr.role !== "user") throw new Error("impossible");
    expect(userIr.content).toEqual([{ type: "text", content: "one\ntwo" }]);
  });

  it("runs an allowed tool batch and responds with its output", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("cats", "c1")] })),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("search for cats"));
    expect(await traj.step()).toBe(true);
    expect(traj.mode.mode).toBe("responding");

    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant", "tool-output", "assistant"]);
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual(["user", "assistant", "tool-output"]);
    expect(rec.modes).toContain("tool-call-permission");
    expect(rec.modes).toContain("running-tool");
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("records a tool's error as tool-runtime-error and continues", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("cats", "c1")] })),
      plainOk,
    ]);
    runImpl = async () => err("the search blew up");

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant", "tool-runtime-error", "assistant"]);
    const result = traj.messages[2];
    if (result.role !== "tool-runtime-error") throw new Error("impossible");
    expect(result.error).toBe("the search blew up");
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual([
      "user",
      "assistant",
      "tool-runtime-error",
    ]);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("appends a tool's custom IR directly to history", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ toolCalls: [shellCall("ls", "c1")] })),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant", "shell-result", "assistant"]);
    const result = traj.messages[2];
    if (result.role !== "shell-result") throw new Error("impossible");
    expect(result.transcript).toBe("ran ok");
    expect(result.toolCall.toolCallId).toBe("c1");
    const lowered = compilerCalls[1].irs;
    expect(lowered.map(m => m.role)).toEqual(["user", "assistant", "tool-output"]);
    if (lowered[2].role !== "tool-output") throw new Error("impossible");
    expect(lowered[2].content).toEqual(text("ran ok"));
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("throws when a tool tries to invoke a subagent", async () => {
    const { build } = makeTrajectory();
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("cats", "c1")] })),
    ]);
    runImpl = async () => ok({ type: "invoke-subagent", name: "research", message: text("go") });

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    await expect(traj.step()).rejects.toThrow("Subagent invocation is not supported: research");
  });

  it("skips unanswered tool calls when a tool throws, then rethrows", async () => {
    const { build } = makeTrajectory();
    const { traj } = await build([
      () =>
        okResult(assistantMessage({ toolCalls: [searchCall("a", "c1"), searchCall("b", "c2")] })),
    ]);
    runImpl = async query => {
      if (query === "a") throw new Error("boom in tool");
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run em"));
    expect(await traj.step()).toBe(true);
    await expect(traj.step()).rejects.toThrow("boom in tool");

    expect(traj.messages.map(m => m.role)).toEqual([
      "user",
      "assistant",
      "tool-skip-output",
      "tool-skip-output",
    ]);
    const skip = traj.messages[2];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.toolCall.toolCallId).toBe("c1");
    expect(skip.reason).toBe("The tool batch failed unexpectedly, so this tool was skipped");
  });

  it("rejects a call with a marker, skips the remainder, steers, and responds again", async () => {
    const { build, rec } = makeTrajectory({
      permission: async () => ({ decision: "reject", steering: text("do it differently") }),
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(assistantMessage({ toolCalls: [searchCall("a", "c1"), searchCall("b", "c2")] })),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("run em"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "tool-reject",
      "tool-skip-output",
      "user",
      "assistant",
    ]);
    const continuation = compilerCalls[1].irs;
    expect(continuation.map(m => m.role)).toEqual([
      "user",
      "assistant",
      "tool-skip-output",
      "tool-skip-output",
      "user",
    ]);
    const skip = continuation[3];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.reason).toBe("A previous tool call was rejected, so this tool was skipped");
    const steering = continuation[4];
    if (steering.role !== "user") throw new Error("impossible");
    expect(steering.content).toEqual(text("do it differently"));
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("runs every call in an allowed batch, gating each one", async () => {
    const queries: string[] = [];
    const { build, rec } = makeTrajectory();
    const { traj } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("a", "c1"), searchCall("b", "c2"), searchCall("c", "c3")],
          }),
        ),
      plainOk,
    ]);
    runImpl = async query => {
      queries.push(query);
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run em all"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(queries).toEqual(["a", "b", "c"]);
    expect(rec.modes).toEqual([
      "responding",
      "tool-call",
      "tool-call-permission",
      "running-tool",
      "tool-call-permission",
      "running-tool",
      "tool-call-permission",
      "running-tool",
      "responding",
      "ready-for-request",
    ]);
    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-output",
      "tool-output",
      "assistant",
    ]);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("keeps settled outputs when a later call is rejected", async () => {
    const { build, rec } = makeTrajectory({
      permission: async toolCall =>
        toolCall.name === "search" && toolCall.parsed.query === "b"
          ? { decision: "reject", steering: text("not b") }
          : { decision: "allow" },
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("a", "c1"), searchCall("b", "c2"), searchCall("c", "c3")],
          }),
        ),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("run em"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-reject",
      "tool-skip-output",
      "user",
      "assistant",
    ]);
    const continuation = compilerCalls[1].irs;
    expect(continuation.map(m => m.role)).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-skip-output",
      "tool-skip-output",
      "user",
    ]);
    const loweredReject = continuation[3];
    if (loweredReject.role !== "tool-skip-output") throw new Error("impossible");
    expect(loweredReject.reason).toBe("Tool call rejected by user.");
    const skip = continuation[4];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.reason).toBe("A previous tool call was rejected, so this tool was skipped");
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("interrupt mid-batch keeps settled output, skips the rest, and waits for input", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("a", "c1"), searchCall("b", "c2"), searchCall("c", "c3")],
          }),
        ),
    ]);
    runImpl = async query => {
      if (query === "b") interruptNow(traj);
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run em all"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-output",
      "tool-skip-output",
    ]);
    const skip = traj.messages[4];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.reason).toBe("The user aborted the response, so this tool was skipped");
    expect(skip.toolCall.toolCallId).toBe("c3");
    expect(traj.mode.mode).toBe("ready-for-request");
    expect(compilerCalls.length).toBe(1);
  });

  it("interrupt at the permission gate skips the whole batch and waits for input", async () => {
    const { build, rec } = makeTrajectory({
      permission: async () => {
        interruptNow(traj);
        return { decision: "allow" };
      },
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(assistantMessage({ toolCalls: [searchCall("a", "c1"), searchCall("b", "c2")] })),
    ]);

    inputControl(traj).enqueueSteering(text("run em"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant", "tool-skip-output", "tool-skip-output"]);
    expect(traj.mode.mode).toBe("ready-for-request");
    expect(compilerCalls.length).toBe(1);
  });

  it("returns false when the exit signal fires while waiting for input", async () => {
    const { build, exit } = makeTrajectory();
    const { traj, compilerCalls } = await build([]);

    exit.abort();
    expect(await traj.step()).toBe(false);
    expect(compilerCalls.length).toBe(0);
  });

  it("run() drives steps until the exit signal and lands aborted", async () => {
    const { build, exit } = makeTrajectory();
    const { traj } = await build([]);

    exit.abort();
    await traj.run();
    expect(traj.mode.mode).toBe("aborted");
  });

  it("exit mid-batch keeps settled output, skips the running and pending calls, and ends", async () => {
    const { build, rec, exit } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("a", "c1"), searchCall("b", "c2"), searchCall("c", "c3")],
          }),
        ),
    ]);
    runImpl = async query => {
      if (query === "b") {
        exit.abort();
        // The tool is still in flight past the exit; its eventual output must be dropped.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run em"));
    await traj.run();

    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-skip-output",
      "tool-skip-output",
    ]);
    const runningSkip = traj.messages[3];
    if (runningSkip.role !== "tool-skip-output") throw new Error("impossible");
    expect(runningSkip.toolCall.toolCallId).toBe("c2");
    expect(runningSkip.reason).toBe(
      "The user exited while this tool was running, so its output was not recorded",
    );
    const pendingSkip = traj.messages[4];
    if (pendingSkip.role !== "tool-skip-output") throw new Error("impossible");
    expect(pendingSkip.toolCall.toolCallId).toBe("c3");
    expect(pendingSkip.reason).toBe("The user aborted the response, so this tool was skipped");
    expect(traj.mode.mode).toBe("aborted");
    expect(compilerCalls.length).toBe(1);
  });

  it("exit parked at the permission gate skip-marks the whole batch", async () => {
    const { build, rec, exit } = makeTrajectory({
      permission: () => new Promise(() => {}),
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(assistantMessage({ toolCalls: [searchCall("a", "c1"), searchCall("b", "c2")] })),
    ]);

    inputControl(traj).enqueueSteering(text("run em"));
    const running = traj.run();
    while (!rec.modes.includes("tool-call-permission")) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    exit.abort();
    await running;

    expect(rec.roles).toEqual(["user", "assistant", "tool-skip-output", "tool-skip-output"]);
    const [first, second] = [traj.messages[2], traj.messages[3]];
    if (first.role !== "tool-skip-output" || second.role !== "tool-skip-output") {
      throw new Error("impossible");
    }
    expect(first.toolCall.toolCallId).toBe("c1");
    expect(first.reason).toBe("The user aborted the response, so this tool was skipped");
    expect(second.toolCall.toolCallId).toBe("c2");
    expect(traj.mode.mode).toBe("aborted");
    expect(compilerCalls.length).toBe(1);
  });

  it("exit mid-batch keeps earlier answers and skips only the unanswered", async () => {
    let parked = false;
    const { build, rec, exit } = makeTrajectory({
      permission: async toolCall => {
        if (toolCall.toolCallId === "c2") {
          parked = true;
          await new Promise(() => {});
        }
        return { decision: "allow" };
      },
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(assistantMessage({ toolCalls: [searchCall("a", "c1"), searchCall("b", "c2")] })),
    ]);

    inputControl(traj).enqueueSteering(text("run em"));
    const running = traj.run();
    while (!parked) await new Promise(resolve => setTimeout(resolve, 0));
    exit.abort();
    await running;

    expect(rec.roles).toEqual(["user", "assistant", "tool-output", "tool-skip-output"]);
    const skip = traj.messages[3];
    if (skip.role !== "tool-skip-output") throw new Error("impossible");
    expect(skip.toolCall.toolCallId).toBe("c2");
    expect(skip.reason).toBe("The user aborted the response, so this tool was skipped");
    expect(traj.mode.mode).toBe("aborted");
    expect(compilerCalls.length).toBe(1);
  });

  it("returns false when the exit signal fires while parked in an error mode", async () => {
    const { build, exit } = makeTrajectory();
    const { traj } = await build([() => err(requestError("boom"))]);

    inputControl(traj).enqueueSteering(text("go"));
    expect(await traj.step()).toBe(true);
    expect(traj.mode.mode).toBe("request-error");

    exit.abort();
    expect(await traj.step()).toBe(false);
    expect(traj.mode.mode).toBe("aborted");
  });

  it("interrupt mid-response keeps the partial assistant message and waits for input", async () => {
    const { build, rec } = makeTrajectory();
    const queue: CompilerQueueItem[] = [];
    const { traj, compilerCalls } = await build(queue);

    inputControl(traj).enqueueSteering(text("hi"));
    queue.push(onTokens => {
      onTokens("partial answer", "content");
      interruptNow(traj);
      return okResult(assistantMessage({ content: "full answer" }));
    }, plainOk);

    expect(await traj.step()).toBe(true);
    expect(rec.roles).toEqual(["user", "assistant"]);
    const partial = traj.messages[1];
    if (partial.role !== "assistant") throw new Error("impossible");
    expect(partial.content).toBe("partial answer");
    expect(rec.modes).toEqual(["responding", "ready-for-request"]);
    expect(rec.arc.responseProgress).toBe(1);
    expect(rec.arc.onResponseHeaders).toBe(1);
    expect(compilerCalls.length).toBe(1);

    inputControl(traj).enqueueSteering(text("again"));
    expect(await traj.step()).toBe(true);
    expect(compilerCalls.length).toBe(2);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("rectifies a request error by retrying with a fresh resolution", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([() => err(requestError("boom")), plainOk]);

    inputControl(traj).enqueueSteering(text("go"));
    expect(await traj.step()).toBe(true);
    expect(rec.modes).toEqual(["responding", "request-error"]);

    rectifyControl(traj).retry();
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(2);
    expect(rec.modelCalls).toBe(2);
    expect(rec.loadToolsCalls).toBe(2);
    expect(rec.modes).toEqual(["responding", "request-error", "responding", "ready-for-request"]);
  });

  it("rewinds past the last user message, fires the rewind event once, and ignores stale rewinds", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      onTokens => {
        onTokens("partial response", "content");
        return err(requestError("boom"));
      },
      plainOk,
    ]);

    const readyControl = inputControl(traj);
    readyControl.enqueueSteering(text("please do the thing"));
    expect(await traj.step()).toBe(true);
    expect(rec.roles).toEqual(["user", "assistant", "request-error"]);

    readyControl.enqueueSteering(text("staged while parked"));
    await rectifyControl(traj).rewind();
    await rectifyControl(traj).rewind();

    expect(rec.rewinds.length).toBe(1);
    expect(rec.rewinds[0].content).toEqual(text("please do the thing"));
    expect(rec.rewinds[0].removed.map(ir => ir.role)).toEqual([
      "user",
      "assistant",
      "request-error",
    ]);
    expect(rec.timeline.filter(e => e.startsWith("steering"))).toEqual([
      "steering:1u0q",
      "steering:0u0q",
      "steering:0u1q",
      "steering:0u0q",
    ]);
    expect(traj.messages.length).toBe(0);

    expect(await traj.step()).toBe(true);
    expect(traj.mode.mode).toBe("ready-for-request");
    expect(compilerCalls.length).toBe(1);

    inputControl(traj).enqueueSteering(text("edited request"));
    expect(await traj.step()).toBe(true);
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual(["user"]);
  });

  it("retries auth errors with a fresh resolution", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () => err({ type: "auth-error", authError: "no key" }),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("auth please"));
    expect(await traj.step()).toBe(true);

    retryControl(traj).retry();
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(2);
    expect(rec.modelCalls).toBe(2);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("clears auth errors back to waiting for input", async () => {
    const { build } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () => err({ type: "auth-error", authError: "no key" }),
    ]);

    inputControl(traj).enqueueSteering(text("auth please"));
    expect(await traj.step()).toBe(true);

    retryControl(traj).clear?.();
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(1);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("maps a model-resolution auth failure to the auth-error mode without a compiler call", async () => {
    let failing = true;
    const { build, rec } = makeTrajectory({
      modelAuthError: () => (failing ? "no key" : undefined),
    });
    const { traj, compilerCalls } = await build([plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(0);
    expect(rec.modes).toEqual(["auth-error"]);
    expect(traj.mode).toEqual(expect.objectContaining({ mode: "auth-error", authError: "no key" }));

    failing = false;
    retryControl(traj).retry();
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(1);
    expect(rec.modelCalls).toBe(2);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("maps retryable error finishes to retry modes and drives retries", async () => {
    const { build, rec } = makeTrajectory();
    const { traj } = await build([() => err(rateLimitError()), plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);
    expect(rec.modes).toEqual(["responding", "rate-limit-error"]);

    retryControl(traj).retry();
    expect(await traj.step()).toBe(true);

    expect(rec.modes).toEqual([
      "responding",
      "rate-limit-error",
      "responding",
      "ready-for-request",
    ]);
  });

  it("maps exhausted retry budgets to the matching error mode", async () => {
    const first = makeTrajectory({ requestErrorRetries: { maxRetryCount: 1, backoffMs: 1 } });
    const firstBuild = await first.build([
      () => err(rateLimitError()),
      () => err(rateLimitError()),
    ]);

    inputControl(firstBuild.traj).enqueueSteering(text("hi"));
    expect(await firstBuild.traj.step()).toBe(true);
    expect(firstBuild.traj.mode).toEqual(
      expect.objectContaining({ mode: "rate-limit-error", requestError: "slow down" }),
    );

    const second = makeTrajectory({ requestErrorRetries: { maxRetryCount: 1, backoffMs: 1 } });
    const secondBuild = await second.build([
      () => err(requestError("boom")),
      () => err(requestError("boom")),
    ]);

    inputControl(secondBuild.traj).enqueueSteering(text("hi"));
    expect(await secondBuild.traj.step()).toBe(true);
    expect(secondBuild.traj.mode).toEqual(
      expect.objectContaining({ mode: "request-error", requestError: "boom", curl: "curl" }),
    );
  });

  it("maps payment errors to a retry mode and recovers", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () =>
        err({
          type: "payment-error",
          requestError: "pay up",
          curl: "curl",
          headers: new Headers(),
        }),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);
    expect(rec.modes).toEqual(["responding", "payment-error"]);

    retryControl(traj).retry();
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(2);
    expect(rec.modes).toEqual(["responding", "payment-error", "responding", "ready-for-request"]);
  });

  it("announces request-error-retrying while backing off, then recovers", async () => {
    const { build, rec } = makeTrajectory({
      requestErrorRetries: { maxRetryCount: 1, backoffMs: 1 },
    });
    const { traj, compilerCalls } = await build([() => err(requestError("boom")), plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(2);
    expect(rec.modes).toEqual([
      "responding",
      "request-error-retrying",
      "responding",
      "ready-for-request",
    ]);
    expect(rec.modeObjs[1]).toEqual(
      expect.objectContaining({ error: "boom", attempt: 1, delayMs: 1 }),
    );
    expect(rec.arc.requestRetry).toBe(1);
    expect(rec.arc.startResponse).toBe(2);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("maps validation budget exhaustion to a request-error mode", async () => {
    const { build, rec } = makeTrajectory({ validationRetries: 0 });
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("invalid", "c1")] })),
    ]);

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "tool-validation-error",
      "validation-retry-budget-exceeded",
    ]);
    expect(traj.mode).toEqual(
      expect.objectContaining({
        mode: "request-error",
        requestError: "The model repeatedly produced invalid tool calls",
        curl: null,
      }),
    );
    expect(compilerCalls.length).toBe(1);
  });

  it("announces autofix-tool and runs the corrected call", async () => {
    const queries: string[] = [];
    const { build, rec } = makeTrajectory({
      errorCorrection: {
        tools: {
          search: async () => ({ query: "fixed" }),
        },
      },
    });
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("invalid", "c1")] })),
      plainOk,
    ]);
    runImpl = async query => {
      queries.push(query);
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.modes).toContain("autofix-tool");
    expect(rec.arc.autofixTool).toBe(1);
    expect(queries).toEqual(["fixed"]);
    expect(rec.roles).toEqual(["user", "assistant", "tool-output", "assistant"]);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("announces autofix-json when the compiler runs a json correction", async () => {
    const { build, rec } = makeTrajectory({
      errorCorrection: {
        json: async () => ({ success: true, fixed: {} }),
      },
    });
    const { traj } = await build([
      async (onTokens, params) => {
        if (params.autofixJson == null) throw new Error("expected autofixJson to be offered");
        await params.autofixJson("{bad json", params.abortSignal);
        return okResult(assistantMessage({ content: "done" }));
      },
    ]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(rec.modes).toEqual(["responding", "autofix-json", "ready-for-request"]);
    expect(rec.arc.autofixJson).toBe(1);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("folds steering queued during a batch into the continuation", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("a", "c1")] })),
      plainOk,
    ]);
    runImpl = async query => {
      inputControl(traj).enqueueSteering(text("while you ran"));
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant", "tool-output", "user", "assistant"]);
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual([
      "user",
      "assistant",
      "tool-output",
      "user",
    ]);
  });

  it("classifies a ready-mode submit as upcoming and drains it before any mode change", async () => {
    const { build, rec } = makeTrajectory();
    const { traj } = await build([plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(rec.timeline).toEqual([
      "steering:1u0q",
      "steering:0u0q",
      "ir:user",
      "mode:responding",
      "ir:assistant",
      "mode:ready-for-request",
    ]);
  });

  it("classifies steering pushed mid-turn as queued and folds it before the continuation mode", async () => {
    const { build, rec } = makeTrajectory();
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("a", "c1")] })),
      plainOk,
    ]);
    runImpl = async query => {
      inputControl(traj).enqueueSteering(text("while you ran"));
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.timeline).toEqual([
      "steering:1u0q",
      "steering:0u0q",
      "ir:user",
      "mode:responding",
      "ir:assistant",
      "mode:tool-call",
      "mode:tool-call-permission",
      "mode:running-tool",
      "steering:0u1q",
      "ir:tool-output",
      "steering:0u0q",
      "ir:user",
      "mode:responding",
      "ir:assistant",
      "mode:ready-for-request",
    ]);
  });

  it("compacts an over-full history, then responds", async () => {
    const { build, rec } = makeTrajectory({
      contextWindow: 300,
      messages: [{ role: "user", content: text("x".repeat(2000)) }],
    });
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ content: "summary text" })),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(rec.modes).toEqual(["compacting", "responding", "ready-for-request"]);
    expect(rec.arc.compaction).toBe(1);
    expect(rec.roles).toEqual(["user", "checkpoint", "assistant"]);
    expect(traj.messages.map(m => m.role)).toEqual(["user", "user", "checkpoint", "assistant"]);
    expect(compilerCalls.length).toBe(2);
    expect(compilerCalls[0].irs.map(m => m.role)).toEqual(["user", "user", "user"]);
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual(["lowered-checkpoint"]);
  });

  it("rectifies a compaction error and recovers on retry", async () => {
    const { build, rec } = makeTrajectory({
      contextWindow: 300,
      messages: [{ role: "user", content: text("x".repeat(2000)) }],
    });
    const { traj, compilerCalls } = await build([
      () => err(requestError("boom")),
      () => okResult(assistantMessage({ content: "summary text" })),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(rec.modes).toEqual(["compacting", "compaction-error"]);
    expect(rec.roles).toEqual(["user", "compaction-error"]);
    expect(traj.mode).toEqual(
      expect.objectContaining({ mode: "compaction-error", requestError: "boom", curl: "curl" }),
    );

    rectifyControl(traj).retry();
    expect(await traj.step()).toBe(true);

    expect(compilerCalls.length).toBe(3);
    expect(rec.modes).toEqual([
      "compacting",
      "compaction-error",
      "compacting",
      "responding",
      "ready-for-request",
    ]);
    expect(rec.roles).toEqual(["user", "compaction-error", "checkpoint", "assistant"]);
  });

  it("suppresses the ready announce when steering arrives mid-response", async () => {
    const { build, rec } = makeTrajectory();
    const queue: CompilerQueueItem[] = [];
    const { traj, compilerCalls } = await build(queue);

    inputControl(traj).enqueueSteering(text("hi"));
    queue.push(() => {
      inputControl(traj).enqueueSteering(text("before you finish"));
      return okResult(assistantMessage({ content: "a" }));
    }, plainOk);

    expect(await traj.step()).toBe(true);
    expect(rec.modes).toEqual(["responding"]);

    expect(await traj.step()).toBe(true);
    expect(rec.modes).toEqual(["responding", "responding", "ready-for-request"]);
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("rejects oversized tool outputs with the client's error copy", async () => {
    const { build, rec } = makeTrajectory({ maxToolOutput: 10 });
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("huge", "c1")] })),
      plainOk,
    ]);
    runImpl = async () => ok({ type: "output", content: text("x".repeat(1000)) });

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.capCalls.length).toBe(1);
    const cappedIr = rec.capCalls[0];
    if (typeof cappedIr !== "object" || cappedIr == null || !("role" in cappedIr)) {
      throw new Error("impossible");
    }
    expect(cappedIr.role).toBe("tool-output");
    expect(rec.roles).toEqual(["user", "assistant", "tool-runtime-error", "assistant"]);
    const result = traj.messages[2];
    if (result.role !== "tool-runtime-error") throw new Error("impossible");
    expect(result.error).toBe("OUTPUT TOO LARGE");
  });

  it("caps at 20% of the context window by default", async () => {
    const { build, rec } = makeTrajectory({ contextWindow: 1000 });
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("huge", "c1")] })),
      plainOk,
    ]);
    runImpl = async () => ok({ type: "output", content: text("x".repeat(1000)) });

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.capCalls.length).toBe(1);
    expect(rec.roles).toContain("tool-runtime-error");
  });

  it("honors an injected countTokens implementation over the default", async () => {
    const countsSeen: number[] = [];
    const { build, rec } = makeTrajectory({
      maxToolOutput: 10,
      countTokens: irs => {
        countsSeen.push(irs.length);
        return 0;
      },
    });
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("huge", "c1")] })),
      plainOk,
    ]);
    runImpl = async () => ok({ type: "output", content: text("x".repeat(1000)) });

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(rec.capCalls.length).toBe(0);
    expect(rec.roles).toContain("tool-output");
    expect(countsSeen.length).toBe(2);
    expect(countsSeen[0]).toBe(countsSeen[1] + 1);
  });

  it("drives steps through a custom loop controller", async () => {
    let stepsSeen = 0;
    const { build, exit } = makeTrajectory({
      loopController: async step => {
        stepsSeen++;
        expect(await step()).toBe(false);
      },
    });
    const { traj } = await build([]);

    exit.abort();
    await traj.run();

    expect(stepsSeen).toBe(1);
    expect(traj.mode.mode).toBe("aborted");
  });

  it("runs tools without a permission gate for permissionless agents", async () => {
    const searchDef = await searchTool({
      signal: new AbortController().signal,
      transport,
      data: { marker: "fresh" },
    });
    if (searchDef == null) throw new Error("search tool failed to load");
    const modes: string[] = [];
    const roles: string[] = [];
    const { runCompiler } = makeRunCompiler([
      () => okResult(assistantMessage({ toolCalls: [searchCall("a", "c1")] })),
      plainOk,
    ]);
    const traj = new Trajectory({
      agent: _plainAgent,
      model: async () => ok({ model: null, contextWindow: 10_000 }),
      loadTools: async () => ({ search: searchDef }),
      toolContentTooLargeError: async () => "OUTPUT TOO LARGE",
      messages: [],
      toolData: { marker: "fresh" },
      runCompiler,
      subagentPrompts: { research: async () => "You are the research subagent." },
      lowerMessages: messages => messages,
      transport,
      abortSignal: new AbortController().signal,
      handler: {
        modeChange: mode => {
          modes.push(mode.mode);
        },
        onMessage: ir => {
          roles.push(ir.role);
        },
      },
    });

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    expect(modes).toEqual([
      "responding",
      "tool-call",
      "running-tool",
      "responding",
      "ready-for-request",
    ]);
    expect(roles).toEqual(["user", "assistant", "tool-output", "assistant"]);
  });

  it("coalesces text and image steering parts in push order", async () => {
    const { build } = makeTrajectory();
    const { traj, compilerCalls } = await build([plainOk]);

    inputControl(traj).enqueueSteering([{ type: "text", content: "one" }, img("first.png")]);
    inputControl(traj).enqueueSteering([{ type: "text", content: "two" }, img("second.png")]);
    expect(await traj.step()).toBe(true);

    const userIr = compilerCalls[0].irs[0];
    if (userIr.role !== "user") throw new Error("impossible");
    expect(userIr.content).toEqual([
      { type: "text", content: "one\ntwo" },
      img("first.png"),
      img("second.png"),
    ]);
  });

  it("starts from seeded history", async () => {
    const { build } = makeTrajectory({
      messages: [
        { role: "user", content: text("old question") },
        assistantMessage({ content: "old answer" }),
      ],
    });
    const { traj, compilerCalls } = await build([plainOk]);

    inputControl(traj).enqueueSteering(text("new question"));
    expect(await traj.step()).toBe(true);

    expect(compilerCalls[0].irs.map(m => m.role)).toEqual(["user", "assistant", "user"]);
    const first = compilerCalls[0].irs[0];
    if (first.role !== "user") throw new Error("impossible");
    expect(first.content).toEqual(text("old question"));
    expect(traj.messages.length).toBe(4);
  });
});
