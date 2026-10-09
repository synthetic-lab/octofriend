import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { t } from "structural";
import { LocalTransport } from "../transports/local.ts";
import type { Transport } from "../transports/transport-common.ts";
import type { ImageInfo } from "../utils/image-utils.ts";
import type { MultimodalConfig } from "./modalities.ts";
import { err, ok, type Result } from "./result.ts";
import { ToolBuilder, type LoadedTools, type ToolCall, type ToolReturn } from "./tool-def.ts";
import {
  definePermissionedAgent,
  definePermissionlessAgent,
  type Agent,
  type AgentIR,
  type AssistantMessage,
  type Checkpoint,
  type LoweredIR,
  type LowerOutputIR,
  type TreeIR,
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
import { subagentPrompt } from "./compilers/ir-prompts.ts";
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
  type TrajectoryToolLoadError,
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

// The capability is uniform down the tree, so each fixture's tree stays uniform: the
// permissioned test agent and the plain agent each own their own research subagent.
const researchAgent = definePermissionedAgent({ tools: { shell: shellTool }, agents: {} });
const plainResearchAgent = definePermissionlessAgent({ tools: {}, agents: {} });

const _testAgent = definePermissionedAgent({
  tools: { search: searchTool, shell: shellTool },
  agents: { research: researchAgent },
});
type TestAgent = typeof _testAgent;
type TestInvocation = Extract<TreeIR<TestAgent>, { role: "tool-invoke-subagent" }>;

const _plainAgent = definePermissionlessAgent({
  tools: { search: searchTool },
  agents: { research: plainResearchAgent },
});

const transport: Transport = new LocalTransport();
const exitControllers: AbortController[] = [];
const waitingSteps: Promise<boolean>[] = [];

afterEach(async () => {
  for (const exit of exitControllers.splice(0)) exit.abort();
  await Promise.all(waitingSteps.splice(0));
});

async function startWaitingStep<A extends Agent<any, any, any>, Model>(
  traj: Trajectory<A, Model>,
  mode: TrajectoryMode<TestAgent>["mode"],
): Promise<{ finished: Promise<boolean> }> {
  const before = traj.mode;
  const finished = traj.step();
  waitingSteps.push(finished);
  const deadline = Date.now() + 1000;
  while (traj.mode === before || traj.mode.mode !== mode) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${mode}`);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { finished };
}

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

type Emit = (tokens: string, type: "reasoning" | "content") => Promise<void>;
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
  const calls: Array<{
    irs: Array<LoweredIR<any>>;
    tools: string[];
    systemPrompt: string | undefined;
  }> = [];
  const runCompiler: Compiler<null> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, null, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    calls.push({
      irs: [...params.irs] as Array<LoweredIR<any>>,
      tools: Object.keys(params.tools ?? {}),
      systemPrompt: await params.systemPrompt?.(),
    });
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
  modalities?: MultimodalConfig | null;
  maxToolOutput?: number;
  countTokens?: (irs: Array<LoweredIR<TestAgent["tools"]>>) => number;
  toolContentTooLargeError?: (ir: unknown) => Promise<string>;
  requestErrorRetries?: { maxRetryCount?: number; backoffMs: number; maxBackoffMs?: number };
  validationRetries?: number;
  errorCorrection?: ErrorCorrection<TestAgent>;
  loopController?: TrajectoryLoopController;
  messages?: Array<AgentIR<TestAgent>>;
  onMessage?: (event: TrajectoryEvents<TestAgent>["onMessage"]) => void | Promise<void>;
  modelAuthError?: (invocation: TestInvocation | null) => string | undefined;
  loadTools?: (
    signal: AbortSignal,
  ) => Promise<Result<Partial<LoadedTools<TestAgent["tools"]>>, TrajectoryToolLoadError>>;
}) {
  const rec = {
    modes: [] as Array<TrajectoryMode<TestAgent>["mode"]>,
    modeObjs: [] as Array<TrajectoryMode<TestAgent>>,
    roles: [] as string[],
    messages: [] as Array<TrajectoryEvents<TestAgent>["onMessage"]>,
    timeline: [] as string[],
    rewinds: [] as Array<TrajectoryEvents<TestAgent>["rewind"]>,
    capCalls: [] as unknown[],
    loweringModalities: [] as Array<MultimodalConfig | null>,
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
    modelInvocations: [] as Array<TestInvocation | null>,
    loadToolsCalls: 0,
  };
  const exit = new AbortController();
  exitControllers.push(exit);

  const build = async (queue: CompilerQueueItem[]) => {
    const [searchDef, shellDef] = await Promise.all([
      searchTool({ signal: new AbortController().signal, transport, data: { marker: "fresh" } }),
      shellTool({ signal: new AbortController().signal, transport, data: { marker: "fresh" } }),
    ]);
    if (searchDef == null || shellDef == null) throw new Error("tools failed to load");
    const { runCompiler, calls } = makeRunCompiler(queue);
    const traj = new Trajectory({
      agent: _testAgent,
      model: async invocation => {
        rec.modelCalls++;
        rec.modelInvocations.push(invocation);
        const authError = opts?.modelAuthError?.(invocation);
        if (authError != null) return err({ type: "auth-error", authError });
        return ok({
          model: null,
          contextWindow: opts?.contextWindow ?? 10_000,
          modalities: opts?.modalities ?? null,
        });
      },
      loadTools: async signal => {
        rec.loadToolsCalls++;
        if (opts?.loadTools != null) return opts.loadTools(signal);
        return ok({ search: searchDef, shell: shellDef });
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
      lowerMessages: (messages, modalities) => {
        rec.loweringModalities.push(modalities);
        const pairs: Array<LowerOutputIR<TestAgent>> = [];
        for (const original of messages) {
          if (original.role === "shell-result") {
            pairs.push({
              original,
              converted: {
                role: "tool-output",
                toolCall: original.toolCall,
                content: text(original.transcript),
              },
            });
          } else {
            pairs.push({ original, converted: original });
          }
        }
        return pairs;
      },
      transport,
      abortSignal: exit.signal,
      permission: async toolCall => {
        return opts?.permission ? opts.permission(toolCall) : { decision: "allow" };
      },
      handler: {
        modeChange: ({ mode }) => {
          rec.modes.push(mode.mode);
          rec.modeObjs.push(mode);
          rec.timeline.push(`mode:${mode.mode}`);
        },
        onMessage: async event => {
          rec.messages.push(event);
          rec.roles.push(event.ir.role);
          rec.timeline.push(`ir:${event.ir.role}`);
          await opts?.onMessage?.(event);
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

function inputControl<A extends Agent<any, any, any>, Model>(traj: Trajectory<A, Model>) {
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
  it("announces ready only when the next step is waiting for input", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);

    expect(rec.roles).toEqual(["user", "assistant"]);
    expect(compilerCalls.length).toBe(1);
    expect(compilerCalls[0].irs.map(m => m.role)).toEqual(["user"]);
    expect(rec.modes).toEqual(["responding"]);

    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("reloads tools for a batch and reuses that runtime data for its response", async () => {
    let generation = 0;
    const { build, rec } = makeTrajectory({
      loadTools: async signal => {
        const loadedGeneration = ++generation;
        const search = await searchTool({ signal, transport, data: { marker: "fresh" } });
        if (search == null) throw new Error("search tool failed to load");
        return ok({
          search: {
            ...search,
            run: async () =>
              ok({ type: "output", content: text(`generation ${loadedGeneration}`) }),
          },
        });
      },
    });
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("cats", "c1")] })),
      plainOk,
    ]);

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(rec.modelCalls).toBe(1);
    expect(rec.loadToolsCalls).toBe(1);
    expect(await traj.step()).toBe(true);

    const result = traj.messages[2];
    if (result.role !== "tool-output") throw new Error("impossible");
    expect(result.content).toEqual(text("generation 2"));
    expect(rec.modelCalls).toBe(2);
    expect(rec.loadToolsCalls).toBe(2);
  });

  it("uses freshly resolved context and modalities for the whole batch and response", async () => {
    const vision: MultimodalConfig = {
      image: { enabled: true, maxSizeMB: 1, acceptedMimeTypes: ["image/png"] },
    };
    const opts = { contextWindow: 10_000, modalities: null as MultimodalConfig | null };
    const { build, rec } = makeTrajectory(opts);
    const { traj } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("huge", "c1")] })),
      plainOk,
    ]);
    runImpl = async () => {
      // Config changes during execution must not change this step's resolved model context.
      opts.modalities = null;
      return ok({ type: "output", content: text("x".repeat(1000)) });
    };

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(rec.loweringModalities.length).toBeGreaterThan(0);
    expect(rec.loweringModalities.every(modalities => modalities === null)).toBe(true);
    rec.loweringModalities.length = 0;
    opts.contextWindow = 1000;
    opts.modalities = vision;
    expect(await traj.step()).toBe(true);

    expect(rec.capCalls.length).toBe(1);
    expect(rec.roles).toEqual(["user", "assistant", "tool-runtime-error", "assistant"]);
    expect(rec.modelCalls).toBe(2);
    expect(rec.loadToolsCalls).toBe(2);
    // Pending-call scans use null; two size-check lowerings and both arc lowerings use vision.
    expect(rec.loweringModalities.filter(modalities => modalities === vision)).toHaveLength(4);
    expect(rec.loweringModalities).toContain(null);
    expect(rec.loweringModalities.at(-1)).toBe(vision);
  });

  it("only runs current calls when validation retries and later batches reuse IDs", async () => {
    const queries: string[] = [];
    const { build } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("invalid", "c1"), searchCall("skipped", "c2")],
          }),
        ),
      () => okResult(assistantMessage({ toolCalls: [searchCall("a", "c1")] })),
      () => okResult(assistantMessage({ toolCalls: [searchCall("b", "c1")] })),
      plainOk,
    ]);
    runImpl = async query => {
      queries.push(query);
      return ok({ type: "output", content: text(query) });
    };

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(compilerCalls.length).toBe(2);
    expect(queries).toEqual([]);
    expect(await traj.step()).toBe(true);
    expect(queries).toEqual(["a"]);
    expect(await traj.step()).toBe(true);
    expect(queries).toEqual(["a", "b"]);
    expect(traj.messages.filter(ir => ir.role === "tool-output").length).toBe(2);
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
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it.each(["reject", "throw", "exit"] as const)(
    "keeps custom IR answers when a later call triggers %s cleanup",
    async stop => {
      const { build, exit } = makeTrajectory({
        permission: async toolCall => {
          if (toolCall.toolCallId !== "c2") return { decision: "allow" };
          if (stop === "reject") return { decision: "reject", steering: text("stop") };
          if (stop === "exit") exit.abort();
          return { decision: "allow" };
        },
      });
      const { traj } = await build([
        () =>
          okResult(
            assistantMessage({
              toolCalls: [shellCall("ls", "c1"), searchCall("a", "c2"), searchCall("b", "c3")],
            }),
          ),
        plainOk,
      ]);
      runImpl = async () => {
        throw new Error("boom in tool");
      };

      inputControl(traj).enqueueSteering(text("run"));
      expect(await traj.step()).toBe(true);
      if (stop === "throw") {
        await expect(traj.step()).rejects.toThrow("boom in tool");
      } else if (stop === "exit") {
        await traj.run();
      } else {
        expect(await traj.step()).toBe(true);
      }

      const answers = traj.messages.filter(ir => "toolCall" in ir);
      expect(answers.map(ir => ir.role)).toEqual([
        "shell-result",
        stop === "reject" ? "tool-reject" : "tool-skip-output",
        "tool-skip-output",
      ]);
      expect(answers.map(ir => ir.toolCall.toolCallId)).toEqual(["c1", "c2", "c3"]);
    },
  );

  it("runs a delegated child before resuming the parent's unanswered calls", async () => {
    const queries: string[] = [];
    const permissions: string[] = [];
    const task = [...text("Inspect this diagram"), img("diagram.png")];
    const { build, rec } = makeTrajectory({
      permission: async call => {
        permissions.push(call.name);
        return { decision: "allow" };
      },
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [
              searchCall("before", "c1"),
              searchCall("delegate", "c2"),
              searchCall("after", "c3"),
            ],
          }),
        ),
      // Reusing a parent ID must not answer a call in the parent's batch.
      () => okResult(assistantMessage({ toolCalls: [shellCall("ls", "c3")] })),
      () => okResult(assistantMessage({ content: "child findings" })),
      plainOk,
    ]);
    runImpl = async query => {
      queries.push(query);
      return query === "delegate"
        ? ok({ type: "invoke-subagent", name: "research", message: task })
        : ok({ type: "output", content: text(query) });
    };

    await inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);
    expect(queries).toEqual(["before", "delegate"]);
    expect(compilerCalls).toHaveLength(2);
    expect(compilerCalls[1].irs).toEqual([{ role: "user", content: subagentPrompt(task) }]);
    expect(compilerCalls[0].tools).toEqual(["search", "shell"]);
    expect(compilerCalls[1].tools).toEqual(["shell"]);
    expect(compilerCalls[1].systemPrompt).toBe("You are the research subagent.");

    const child = traj.messages.at(-1);
    if (child?.role !== "subagent-trajectory") throw new Error("Expected child trajectory");
    expect(child.task).toBe(task);
    expect(child.toolCall.toolCallId).toBe("c2");
    expect(child.ir.map(ir => ir.role)).toEqual(["user", "assistant"]);
    expect(traj.mode).toMatchObject({ root: false, subagent: "research", mode: "responding" });

    await inputControl(traj).enqueueSteering(text("after all the tools"));
    expect(await traj.step()).toBe(true);
    expect(queries).toEqual(["before", "delegate"]);
    expect(child.ir.map(ir => ir.role)).toEqual(["user", "assistant", "shell-result", "assistant"]);
    expect(compilerCalls[2].irs.map(ir => ir.role)).toEqual(["user", "assistant", "tool-output"]);
    expect(traj.messages.at(-1)).toBe(child);
    const childEvents = rec.messages.filter(event => !event.root);
    expect(childEvents.map(event => event.ir.role)).toEqual([
      "assistant",
      "shell-result",
      "assistant",
    ]);
    for (const event of childEvents) {
      expect(event.scope.parentSubagentIR).toBe(child);
      expect(event.scope.toplevelSubagentIR).toBe(child);
      expect(event.scope.path).toEqual([{ subagent: "research", toolCallId: "c2" }]);
    }

    expect(await traj.step()).toBe(true);
    expect(queries).toEqual(["before", "delegate", "after"]);
    expect(permissions).toEqual(["search", "search", "shell", "search"]);
    expect(traj.messages.map(ir => ir.role)).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-invoke-subagent",
      "subagent-trajectory",
      "tool-output",
      "user",
      "assistant",
    ]);
    const continuation = compilerCalls[3].irs;
    expect(continuation.map(ir => ir.role)).toEqual([
      "user",
      "assistant",
      "tool-output",
      "tool-output",
      "tool-output",
      "user",
    ]);
    expect(continuation[3]).toMatchObject({
      role: "tool-output",
      toolCall: { toolCallId: "c2" },
      content: text("child findings"),
    });
    expect(continuation[4]).toMatchObject({ role: "tool-output", toolCall: { toolCallId: "c3" } });
    expect(continuation[5]).toEqual({ role: "user", content: text("after all the tools") });
    expect(rec.modeObjs.filter(mode => mode.mode === "responding").map(mode => mode.root)).toEqual([
      true,
      false,
      false,
      true,
    ]);
    await startWaitingStep(traj, "ready-for-request");
  });

  it.each(["success", "failure"] as const)(
    "resumes a batch containing consecutive delegations after child %s",
    async outcome => {
      const queries: string[] = [];
      const { build, rec } = makeTrajectory();
      const { traj, compilerCalls } = await build([
        () =>
          okResult(
            assistantMessage({
              toolCalls: [searchCall("first", "c1"), searchCall("second", "c2")],
            }),
          ),
        outcome === "success" ? plainOk : () => err(requestError("child failed")),
        plainOk,
        plainOk,
      ]);
      runImpl = async query => {
        queries.push(query);
        return ok({ type: "invoke-subagent", name: "research", message: text(query) });
      };

      await inputControl(traj).enqueueSteering(text("delegate twice"));
      expect(await traj.step()).toBe(true);
      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["first"]);
      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["first", "second"]);
      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["first", "second"]);
      expect(compilerCalls).toHaveLength(4);
      expect(compilerCalls[3].irs.map(ir => ir.role)).toEqual([
        "user",
        "assistant",
        outcome === "success" ? "tool-output" : "tool-runtime-error",
        "tool-output",
      ]);
      if (outcome === "failure") {
        expect(compilerCalls[3].irs[2]).toMatchObject({
          role: "tool-runtime-error",
          error: "child failed",
          toolCall: { toolCallId: "c1" },
        });
      }
      expect(traj.messages.filter(ir => ir.role === "subagent-trajectory")).toHaveLength(2);
      expect(rec.modes).not.toContain("request-error");
      await startWaitingStep(traj, "ready-for-request");
    },
  );

  it("records a child model-resolution failure in the child and retries the same invocation", async () => {
    let failing = true;
    const { build, rec } = makeTrajectory({
      modelAuthError: invocation =>
        failing && invocation?.model === "child-model" ? "child credentials missing" : undefined,
    });
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ toolCalls: [searchCall("delegate", "c1")] })),
      plainOk,
      plainOk,
    ]);
    let delegations = 0;
    runImpl = async () => {
      delegations++;
      return ok({
        type: "invoke-subagent",
        name: "research",
        model: "child-model",
        message: text("go"),
      });
    };
    await inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);
    expect(compilerCalls).toHaveLength(1);
    expect(rec.loadToolsCalls).toBe(2);
    const invocation = traj.messages[2];
    const child = traj.messages[3];
    if (invocation.role !== "tool-invoke-subagent" || child.role !== "subagent-trajectory") {
      throw new Error("Expected delegation");
    }
    expect(child.ir.at(-1)).toEqual({ role: "auth-error", authError: "child credentials missing" });
    expect(rec.modelInvocations).toEqual([null, null, invocation]);
    const waiting = await startWaitingStep(traj, "auth-error");
    expect(traj.mode).toMatchObject({ root: false, subagent: "research" });
    failing = false;
    retryControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    expect(rec.modelInvocations[3]).toBe(invocation);
    expect(await traj.step()).toBe(true);
    expect(rec.modelInvocations[4]).toBeNull();
    expect(compilerCalls).toHaveLength(3);
    expect(delegations).toBe(1);
    await startWaitingStep(traj, "ready-for-request");
  });

  it.each([false, true])(
    "resumes a tail invocation without rerunning its tool (auth failure=%s)",
    async authFailure => {
      let failing = authFailure;
      const task = text("Resume this delegated task");
      const toolCall = searchCall("delegate", "c1");
      const { build, rec } = makeTrajectory({
        messages: [
          { role: "user", content: text("run") },
          assistantMessage({ toolCalls: [toolCall] }),
          { role: "tool-invoke-subagent", toolCall, subagent: "research", message: task },
        ],
        modelAuthError: () => (failing ? "credentials expired" : undefined),
      });
      const { traj, compilerCalls } = await build([plainOk, plainOk]);
      runImpl = async () => {
        throw new Error("delegating tool must not run again");
      };

      expect(await traj.step()).toBe(true);
      const child = traj.messages.at(-1);
      if (child?.role !== "subagent-trajectory") throw new Error("Expected child trajectory");
      expect(child.task).toBe(task);
      if (authFailure) {
        expect(compilerCalls).toHaveLength(0);
        expect(child.ir.map(ir => ir.role)).toEqual(["user", "auth-error"]);
        const waiting = await startWaitingStep(traj, "auth-error");
        expect(traj.mode).toMatchObject({ root: false, subagent: "research", mode: "auth-error" });
        failing = false;
        retryControl(traj).retry();
        expect(await waiting.finished).toBe(true);
        expect(child.ir.map(ir => ir.role)).toEqual([
          "user",
          "auth-error",
          "error-retry",
          "assistant",
        ]);
      }
      expect(compilerCalls).toHaveLength(1);
      expect(compilerCalls[0].irs).toEqual([{ role: "user", content: subagentPrompt(task) }]);
      expect(await traj.step()).toBe(true);
      expect(compilerCalls).toHaveLength(2);
      expect(compilerCalls[1].irs[2]).toMatchObject({
        role: "tool-output",
        toolCall: { toolCallId: "c1" },
      });
      expect(rec.modes).not.toContain("running-tool");
      expect(traj.messages.filter(ir => ir.role === "subagent-trajectory")).toHaveLength(1);
      await startWaitingStep(traj, "ready-for-request");
    },
  );

  it.each([undefined, "leaf-model"])(
    "resumes nested parents and selects each invocation's model (leaf=%s)",
    async leafModel => {
      const middle = definePermissionlessAgent({
        tools: { search: searchTool },
        agents: { research: plainResearchAgent },
      });
      const root = definePermissionlessAgent({
        tools: { search: searchTool },
        agents: { research: middle },
      });
      const exit = new AbortController();
      exitControllers.push(exit);
      const search = await searchTool({
        signal: exit.signal,
        transport,
        data: { marker: "fresh" },
      });
      if (search == null) throw new Error("search tool failed to load");
      const queries: string[] = [];
      runImpl = async query => {
        queries.push(query);
        return query.endsWith("delegate")
          ? ok({
              type: "invoke-subagent",
              name: "research",
              message: text(query),
              model: query === "root delegate" ? "middle-model" : leafModel,
            })
          : ok({ type: "output", content: text(query) });
      };
      const { runCompiler, calls } = makeRunCompiler([
        () =>
          okResult(
            assistantMessage({
              toolCalls: [searchCall("root delegate", "c1"), searchCall("root after", "c2")],
            }),
          ),
        () =>
          okResult(
            assistantMessage({
              toolCalls: [searchCall("middle delegate", "c1"), searchCall("middle after", "c2")],
            }),
          ),
        () => okResult(assistantMessage({ content: "leaf findings" })),
        () => okResult(assistantMessage({ content: "middle findings" })),
        plainOk,
      ]);
      const events: Array<TrajectoryEvents<typeof root>["onMessage"]> = [];
      const resolutions: Array<Extract<
        TreeIR<typeof root>,
        { role: "tool-invoke-subagent" }
      > | null> = [];
      const models: string[] = [];
      const compiler: Compiler<string> = params => {
        models.push(params.model);
        return runCompiler({ ...params, model: null });
      };
      const traj = new Trajectory({
        agent: root,
        model: async invocation => {
          resolutions.push(invocation);
          return ok({
            model: invocation?.model ?? "default-model",
            contextWindow: 10_000,
            modalities: null,
          });
        },
        loadTools: async () => ok({ search }),
        toolContentTooLargeError: async () => "OUTPUT TOO LARGE",
        messages: [],
        toolData: { marker: "fresh" },
        runCompiler: compiler,
        systemPrompt: async () => "root prompt",
        subagentPrompts: { research: async () => "research prompt" },
        lowerMessages: messages => messages.map(original => ({ original, converted: original })),
        transport,
        abortSignal: exit.signal,
        handler: {
          onMessage: event => {
            events.push(event);
          },
        },
      });

      await inputControl(traj).enqueueSteering(text("run nested work"));
      expect(await traj.step()).toBe(true);
      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["root delegate"]);
      const outer = traj.messages.at(-1);
      if (outer?.role !== "subagent-trajectory") throw new Error("Expected outer trajectory");
      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["root delegate", "middle delegate"]);
      const inner = outer.ir.at(-1);
      if (inner?.role !== "subagent-trajectory") throw new Error("Expected inner trajectory");
      const leafEvent = events.at(-1);
      if (leafEvent == null || leafEvent.root) throw new Error("Expected leaf event");
      const leafMessage = inner.ir.at(-1);
      if (leafMessage == null) throw new Error("Expected leaf message");
      expect(leafEvent.ir).toBe(leafMessage);
      expect(leafEvent.scope.parentSubagentIR).toBe(inner);
      expect(leafEvent.scope.toplevelSubagentIR).toBe(outer);
      expect(leafEvent.scope.path).toEqual([
        { subagent: "research", toolCallId: "c1" },
        { subagent: "research", toolCallId: "c1" },
      ]);

      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["root delegate", "middle delegate", "middle after"]);
      expect(calls[3].irs[2]).toMatchObject({
        role: "tool-output",
        content: text("leaf findings"),
      });
      expect(await traj.step()).toBe(true);
      expect(queries).toEqual(["root delegate", "middle delegate", "middle after", "root after"]);
      expect(calls[4].irs[2]).toMatchObject({
        role: "tool-output",
        content: text("middle findings"),
      });
      expect(calls.map(call => call.tools)).toEqual([
        ["search"],
        ["search"],
        [],
        ["search"],
        ["search"],
      ]);
      expect(calls.map(call => call.systemPrompt)).toEqual([
        "root prompt",
        "research prompt",
        "research prompt",
        "research prompt",
        "root prompt",
      ]);
      expect(outer.ir.map(ir => ir.role)).toEqual([
        "user",
        "assistant",
        "tool-invoke-subagent",
        "subagent-trajectory",
        "tool-output",
        "assistant",
      ]);
      expect(traj.messages[3]).toBe(outer);
      expect(outer.ir[3]).toBe(inner);
      expect(models).toEqual([
        "default-model",
        "middle-model",
        leafModel ?? "default-model",
        "middle-model",
        "default-model",
      ]);
      expect(resolutions).toHaveLength(7);
      expect(resolutions[0]).toBeNull();
      expect(resolutions[1]).toBeNull();
      expect(resolutions[2] === traj.messages[2]).toBe(true);
      expect(resolutions[3] === traj.messages[2]).toBe(true);
      expect(resolutions[4] === outer.ir[2]).toBe(true);
      expect(resolutions[5] === traj.messages[2]).toBe(true);
      expect(resolutions[6]).toBeNull();
      await startWaitingStep(traj, "ready-for-request");
    },
  );

  it.each(["tool-invoke-subagent", "subagent-trajectory"] as const)(
    "does not start child work when quitting during the %s notification",
    async role => {
      const { build, exit } = makeTrajectory({
        onMessage: async event => {
          if (event.ir.role !== role) return;
          exit.abort();
          await new Promise(resolve => setTimeout(resolve, 0));
        },
      });
      const { traj, compilerCalls } = await build([
        () =>
          okResult(
            assistantMessage({
              toolCalls: [searchCall("delegate", "c1"), searchCall("after", "c2")],
            }),
          ),
      ]);
      runImpl = async () => ok({ type: "invoke-subagent", name: "research", message: text("go") });
      await inputControl(traj).enqueueSteering(text("run"));
      await traj.run();
      expect(compilerCalls).toHaveLength(1);
      expect(traj.mode.mode).toBe("aborted");
      const children = traj.messages.filter(ir => ir.role === "subagent-trajectory");
      expect(children).toHaveLength(role === "subagent-trajectory" ? 1 : 0);
      if (children.length > 0) expect(children[0].ir.at(-1)?.role).toBe("interrupted-by-user");
      expect(
        traj.messages
          .filter(ir => ir.role === "tool-skip-output")
          .map(ir => ir.toolCall.toolCallId),
      ).toEqual(role === "subagent-trajectory" ? ["c2"] : ["c1", "c2"]);
    },
  );

  it("closes the newly inserted child when interrupted during its notification", async () => {
    const { build } = makeTrajectory({
      onMessage: async event => {
        if (event.ir.role === "subagent-trajectory") await interruptNow(traj);
      },
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("delegate", "c1"), searchCall("after", "c2")],
          }),
        ),
    ]);
    runImpl = async () => ok({ type: "invoke-subagent", name: "research", message: text("go") });
    await inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);
    const child = traj.messages.find(ir => ir.role === "subagent-trajectory");
    expect(child?.ir.at(-1)?.role).toBe("interrupted-by-user");
    expect(
      traj.messages.filter(ir => ir.role === "tool-skip-output").map(ir => ir.toolCall.toolCallId),
    ).toEqual(["c2"]);
    expect(compilerCalls).toHaveLength(1);
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "ready-for-request");
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
    const waiting = await startWaitingStep(traj, "request-error");
    expect(traj.mode.mode).toBe("request-error");

    exit.abort();
    expect(await waiting.finished).toBe(false);
    await traj.run();
    expect(traj.mode.mode).toBe("aborted");
  });

  it("interrupt mid-response keeps the partial assistant message and waits for input", async () => {
    const { build, rec } = makeTrajectory();
    const queue: CompilerQueueItem[] = [];
    const { traj, compilerCalls } = await build(queue);

    inputControl(traj).enqueueSteering(text("hi"));
    queue.push(async onTokens => {
      await onTokens("partial answer", "content");
      interruptNow(traj);
      return okResult(assistantMessage({ content: "full answer" }));
    }, plainOk);

    expect(await traj.step()).toBe(true);
    const waiting = await startWaitingStep(traj, "ready-for-request");
    expect(rec.roles).toEqual(["user", "assistant"]);
    const partial = traj.messages[1];
    if (partial.role !== "assistant") throw new Error("impossible");
    expect(partial.content).toBe("partial answer");
    expect(rec.modes).toEqual(["responding", "ready-for-request"]);
    expect(rec.arc.responseProgress).toBe(1);
    expect(rec.arc.onResponseHeaders).toBe(1);
    expect(compilerCalls.length).toBe(1);

    inputControl(traj).enqueueSteering(text("again"));
    expect(await waiting.finished).toBe(true);
    expect(compilerCalls.length).toBe(2);
    await startWaitingStep(traj, "ready-for-request");
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it("rectifies a request error by retrying with a fresh resolution", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([() => err(requestError("boom")), plainOk]);

    inputControl(traj).enqueueSteering(text("go"));
    expect(await traj.step()).toBe(true);
    const waiting = await startWaitingStep(traj, "request-error");
    expect(rec.modes).toEqual(["responding", "request-error"]);

    rectifyControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    await startWaitingStep(traj, "ready-for-request");

    expect(compilerCalls.length).toBe(2);
    expect(rec.modelCalls).toBe(2);
    expect(rec.loadToolsCalls).toBe(2);
    expect(rec.modes).toEqual(["responding", "request-error", "responding", "ready-for-request"]);
  });

  it("rewinds past the last user message, fires the rewind event once, and ignores stale rewinds", async () => {
    const { build, rec } = makeTrajectory();
    const { traj, compilerCalls } = await build([
      async onTokens => {
        await onTokens("partial response", "content");
        return err(requestError("boom"));
      },
      plainOk,
    ]);

    const readyControl = inputControl(traj);
    readyControl.enqueueSteering(text("please do the thing"));
    expect(await traj.step()).toBe(true);
    expect(rec.roles).toEqual(["user", "assistant", "request-error"]);
    const waiting = await startWaitingStep(traj, "request-error");

    readyControl.enqueueSteering(text("staged while parked"));
    const control = rectifyControl(traj);
    await control.rewind();
    await control.rewind();
    while (traj.mode.mode !== "ready-for-request") {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

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
    expect(traj.mode.mode).toBe("ready-for-request");
    expect(compilerCalls.length).toBe(1);

    inputControl(traj).enqueueSteering(text("edited request"));
    expect(await waiting.finished).toBe(true);
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
    const waiting = await startWaitingStep(traj, "auth-error");

    retryControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    await startWaitingStep(traj, "ready-for-request");

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
    await startWaitingStep(traj, "auth-error");

    retryControl(traj).clear?.();
    while (traj.mode.mode !== "ready-for-request") {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

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
    const waiting = await startWaitingStep(traj, "auth-error");
    expect(rec.modes).toEqual(["auth-error"]);
    expect(traj.mode).toEqual(expect.objectContaining({ mode: "auth-error", authError: "no key" }));

    failing = false;
    retryControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    await startWaitingStep(traj, "ready-for-request");

    expect(compilerCalls.length).toBe(1);
    expect(rec.modelCalls).toBe(2);
    expect(traj.mode.mode).toBe("ready-for-request");
  });

  it.each(["retry", "clear"] as const)(
    "%s resumes runtime loading before running pending tools or folding queued steering",
    async resolution => {
      let failing = false;
      const queries: string[] = [];
      const { build, rec } = makeTrajectory({
        modelAuthError: () => (failing ? "credentials changed" : undefined),
      });
      const { traj, compilerCalls } = await build([
        () => okResult(assistantMessage({ toolCalls: [searchCall("cats", "c1")] })),
        plainOk,
      ]);
      runImpl = async query => {
        queries.push(query);
        return ok({ type: "output", content: text(query) });
      };

      inputControl(traj).enqueueSteering(text("run"));
      expect(await traj.step()).toBe(true);
      inputControl(traj).enqueueSteering(text("after the batch"));
      failing = true;
      expect(await traj.step()).toBe(true);
      const waiting = await startWaitingStep(traj, "auth-error");
      expect(traj.mode).toEqual(
        expect.objectContaining({
          mode: "auth-error",
          authError: "credentials changed",
        }),
      );
      expect(queries).toEqual([]);
      expect(compilerCalls.length).toBe(1);
      expect(rec.roles).toEqual(["user", "assistant", "auth-error"]);
      expect(rec.modelCalls).toBe(2);

      failing = false;
      const control = retryControl(traj);
      if (resolution === "retry") control.retry();
      else control.clear?.();
      expect(await waiting.finished).toBe(true);
      expect(queries).toEqual(["cats"]);
      expect(rec.roles).toEqual([
        "user",
        "assistant",
        "auth-error",
        "error-retry",
        "tool-output",
        "user",
        "assistant",
      ]);
      expect(compilerCalls.length).toBe(2);
      expect(rec.modelCalls).toBe(3);
      expect(rec.loadToolsCalls).toBe(3);
    },
  );

  it("exit after a batch runtime-loading error skips pending calls without running them", async () => {
    let failing = false;
    const { build, rec, exit } = makeTrajectory({
      modelAuthError: () => (failing ? "no key" : undefined),
    });
    const { traj, compilerCalls } = await build([
      () =>
        okResult(
          assistantMessage({
            toolCalls: [searchCall("a", "c1"), searchCall("b", "c2")],
          }),
        ),
    ]);
    runImpl = async () => {
      throw new Error("must not run");
    };

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    failing = true;
    expect(await traj.step()).toBe(true);
    await startWaitingStep(traj, "auth-error");
    expect(traj.mode.mode).toBe("auth-error");

    exit.abort();
    await traj.run();
    expect(traj.mode.mode).toBe("aborted");
    expect(rec.roles).toEqual([
      "user",
      "assistant",
      "auth-error",
      "tool-skip-output",
      "tool-skip-output",
    ]);
    expect(
      traj.messages.filter(ir => ir.role === "tool-skip-output").map(ir => ir.toolCall.toolCallId),
    ).toEqual(["c1", "c2"]);
    expect(compilerCalls.length).toBe(1);
  });

  it("maps retryable error finishes to retry modes and drives retries", async () => {
    const { build, rec } = makeTrajectory();
    const { traj } = await build([() => err(rateLimitError()), plainOk]);

    inputControl(traj).enqueueSteering(text("hi"));
    expect(await traj.step()).toBe(true);
    const waiting = await startWaitingStep(traj, "rate-limit-error");
    expect(rec.modes).toEqual(["responding", "rate-limit-error"]);

    retryControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    await startWaitingStep(traj, "ready-for-request");

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
    await startWaitingStep(firstBuild.traj, "rate-limit-error");
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
    await startWaitingStep(secondBuild.traj, "request-error");
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
    const waiting = await startWaitingStep(traj, "payment-error");
    expect(rec.modes).toEqual(["responding", "payment-error"]);

    retryControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    await startWaitingStep(traj, "ready-for-request");

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
    await startWaitingStep(traj, "ready-for-request");
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
    await startWaitingStep(traj, "request-error");
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
    const assistant = traj.messages[1];
    if (assistant.role !== "assistant") throw new Error("impossible");
    expect(assistant.toolCalls?.[0]).toEqual(
      expect.objectContaining({
        original: { query: "invalid" },
        parsed: { query: "fixed" },
      }),
    );
    expect(await traj.step()).toBe(true);

    expect(rec.modes).toContain("autofix-tool");
    expect(rec.arc.autofixTool).toBe(1);
    expect(queries).toEqual(["fixed"]);
    expect(rec.roles).toEqual(["user", "assistant", "tool-output", "assistant"]);
    await startWaitingStep(traj, "ready-for-request");
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

    await startWaitingStep(traj, "ready-for-request");
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

    await startWaitingStep(traj, "ready-for-request");
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

    await startWaitingStep(traj, "ready-for-request");
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

    await startWaitingStep(traj, "ready-for-request");
    expect(rec.modes).toEqual(["compacting", "responding", "ready-for-request"]);
    expect(rec.arc.compaction).toBe(1);
    expect(rec.roles).toEqual(["user", "checkpoint", "assistant"]);
    expect(traj.messages.map(m => m.role)).toEqual(["user", "user", "checkpoint", "assistant"]);
    expect(compilerCalls.length).toBe(2);
    expect(compilerCalls[0].irs.map(m => m.role)).toEqual(["user", "user", "user"]);
    expect(compilerCalls[1].irs.map(m => m.role)).toEqual(["lowered-checkpoint"]);
  });

  it.each([true, false])(
    "renders checkpoints for root=%s without changing stored IR",
    async root => {
      const task = [
        ...text("Investigate the attached diagram"),
        img("diagram.png"),
        ...text("Report only when the investigation is complete"),
      ];
      const checkpoint: Checkpoint = { role: "checkpoint", content: text("Existing summary") };
      const child: Extract<AgentIR<TestAgent>, { role: "subagent-trajectory" }> = {
        role: "subagent-trajectory",
        subagent: "research",
        toolCall: searchCall("delegate", "delegation"),
        task,
        ir: [{ role: "user", content: subagentPrompt(task) }, checkpoint],
      };
      const { build } = makeTrajectory({
        messages: root
          ? [checkpoint]
          : [
              {
                role: "tool-invoke-subagent",
                subagent: child.subagent,
                toolCall: child.toolCall,
                message: task,
              },
              child,
            ],
      });
      const { traj, compilerCalls } = await build([plainOk]);

      expect(await traj.step()).toBe(true);
      const rendered = compilerCalls[0].irs[0];
      if (rendered.role !== "lowered-checkpoint") throw new Error("Expected checkpoint");
      expect(rendered.content).toEqual(
        root
          ? checkpoint.content
          : [...checkpoint.content, ...text("\n\n"), ...subagentPrompt(task)],
      );
      expect(checkpoint.content).toEqual(text("Existing summary"));
      expect(child.task).toBe(task);
      if (!root) expect(child.ir[1]).toBe(checkpoint);
    },
  );

  it("keeps child directives in repeated compactions and tool-output token counts", async () => {
    const task = text("Inspect the workspace and report the result");
    const originalCheckpoint: Checkpoint = { role: "checkpoint", content: text("x".repeat(12000)) };
    const child: Extract<AgentIR<TestAgent>, { role: "subagent-trajectory" }> = {
      role: "subagent-trajectory",
      subagent: "research",
      task,
      toolCall: searchCall("delegate", "delegation"),
      ir: [{ role: "user", content: subagentPrompt(task) }, originalCheckpoint],
    };
    const counted: Array<Array<LoweredIR<TestAgent["tools"]>>> = [];
    const { build } = makeTrajectory({
      contextWindow: 3000,
      messages: [
        assistantMessage({ toolCalls: [child.toolCall] }),
        {
          role: "tool-invoke-subagent",
          subagent: child.subagent,
          toolCall: child.toolCall,
          message: task,
        },
        child,
      ],
      countTokens: irs => {
        counted.push(irs);
        return irs.length;
      },
    });
    const firstRequest = assistantMessage({ toolCalls: [shellCall("pwd", "first")] });
    const secondRequest = assistantMessage({ toolCalls: [shellCall("ls", "second")] });
    firstRequest.usage = compilerUsage(4000, 1);
    secondRequest.usage = compilerUsage(4000, 1);
    const { traj, compilerCalls } = await build([
      () => okResult(assistantMessage({ content: "First summary" })),
      () => okResult(firstRequest),
      () => okResult(assistantMessage({ content: "Second summary" })),
      () => okResult(secondRequest),
      () => okResult(assistantMessage({ content: "Third summary" })),
      plainOk,
    ]);

    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);
    expect(compilerCalls).toHaveLength(6);
    expect(counted).toHaveLength(4);
    const checkpoints = child.ir.filter(ir => ir.role === "checkpoint");
    expect(checkpoints).toHaveLength(4);
    expect(checkpoints[0]).toBe(originalCheckpoint);

    const renderedContent = (checkpoint: Checkpoint) => [
      ...checkpoint.content,
      ...text("\n\n"),
      ...subagentPrompt(task),
    ];
    for (let index = 0; index < checkpoints.length; index++) {
      expect(JSON.stringify(checkpoints[index].content)).not.toContain("You are a subagent");
      if (index === 0) continue;
      const request = compilerCalls[index * 2 - 1].irs[0];
      if (request.role !== "lowered-checkpoint") throw new Error("Expected checkpoint");
      expect(request.content).toEqual(renderedContent(checkpoints[index]));
    }
    for (let index = 0; index < counted.length; index++) {
      const checkpoint = counted[index][0];
      if (checkpoint.role !== "lowered-checkpoint") throw new Error("Expected checkpoint");
      expect(checkpoint.content).toEqual(renderedContent(checkpoints[Math.floor(index / 2) + 1]));
    }
    // Each subsequent compaction sees the same rendering as the preceding normal request.
    expect(compilerCalls[2].irs[0]).toEqual(compilerCalls[1].irs[0]);
    expect(compilerCalls[4].irs[0]).toEqual(compilerCalls[3].irs[0]);
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

    const waiting = await startWaitingStep(traj, "compaction-error");
    expect(rec.modes).toEqual(["compacting", "compaction-error"]);
    expect(rec.roles).toEqual(["user", "compaction-error"]);
    expect(traj.mode).toEqual(
      expect.objectContaining({ mode: "compaction-error", requestError: "boom", curl: "curl" }),
    );

    rectifyControl(traj).retry();
    expect(await waiting.finished).toBe(true);
    await startWaitingStep(traj, "ready-for-request");

    expect(compilerCalls.length).toBe(3);
    expect(rec.modes).toEqual([
      "compacting",
      "compaction-error",
      "compacting",
      "responding",
      "ready-for-request",
    ]);
    expect(rec.roles).toEqual([
      "user",
      "compaction-error",
      "error-retry",
      "checkpoint",
      "assistant",
    ]);
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
    await startWaitingStep(traj, "ready-for-request");
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
    const exit = new AbortController();
    exitControllers.push(exit);
    const traj = new Trajectory({
      agent: _plainAgent,
      model: async () => ok({ model: null, contextWindow: 10_000, modalities: null }),
      loadTools: async () => ok({ search: searchDef }),
      toolContentTooLargeError: async () => "OUTPUT TOO LARGE",
      messages: [],
      toolData: { marker: "fresh" },
      runCompiler,
      subagentPrompts: { research: async () => "You are the research subagent." },
      lowerMessages: messages => messages.map(original => ({ original, converted: original })),
      transport,
      abortSignal: exit.signal,
      handler: {
        modeChange: ({ mode }) => {
          modes.push(mode.mode);
        },
        onMessage: ({ ir }) => {
          roles.push(ir.role);
        },
      },
    });

    inputControl(traj).enqueueSteering(text("run"));
    expect(await traj.step()).toBe(true);
    expect(await traj.step()).toBe(true);

    await startWaitingStep(traj, "ready-for-request");
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
