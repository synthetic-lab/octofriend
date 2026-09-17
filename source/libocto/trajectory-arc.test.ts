import { beforeEach, describe, expect, it } from "bun:test";
import { t } from "structural";
import { LocalTransport } from "../transports/local.ts";
import type { Transport } from "../transports/transport-common.ts";
import { err, ok, type Result } from "./result.ts";
import { ToolBuilder, type LoadedTools, type ToolCall } from "./tool-def.ts";
import {
  defineAgent,
  type Agent,
  type AssistantMessage,
  type LlmIR,
  type MalformedToolRequest,
} from "./llm-ir.ts";
import {
  compilerUsage,
  type Compiler,
  type CompilerError,
  type CompilerParams,
  type CompilerResult,
  type CompilerSuccessData,
} from "./compilers/compiler-interface.ts";
import { lower } from "./lower.ts";
import {
  trajectoryArc,
  type AllFinishReasons,
  type ErrorCorrection,
  type RequestErrorRetriesConfig,
  type RequestErrorRetryBudgetFinishReason,
  type StaticFinishReasons,
  type TrajectoryArcEvents,
  type TrajectoryArcFinish,
  type TrajectoryArcIR,
  type ValidationRetryBudgetFinishReason,
} from "./trajectory-arc.ts";

type TestData = { marker: string };

const dataSeen: TestData[] = [];
let validateImpl: (query: string) => Result<null, string> = () => ok(null);

const searchTool = new ToolBuilder<TestData>()
  .declare({
    name: "search",
    description: "Searches the web",
    ArgumentsSchema: t.subtype({ query: t.str }),
  })
  .define(async () => ({
    validate: async (_abortSignal, _transport, schemaPair, data) => {
      dataSeen.push(data);
      return validateImpl(schemaPair.parsed.arguments.query);
    },
    run: async () => ok({ type: "output" as const, content: [] }),
  }));

const _testAgent = defineAgent({
  tools: { search: searchTool },
  agents: {},
});
type TestAgent = typeof _testAgent;

const transport: Transport = new LocalTransport();

type Emit = (tokens: string, type: "reasoning" | "content") => void;
type QueueItem = (onTokens: Emit) => Result<CompilerSuccessData<TestAgent>, CompilerError>;

function makeRunCompiler(queue: QueueItem[]) {
  const calls: Array<{ irCount: number; hasTools: boolean }> = [];
  const runCompiler: Compiler<null> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, null, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    calls.push({ irCount: params.irs.length, hasTools: params.tools != null });
    const next = queue.shift();
    if (next == null) throw new Error("Unexpected compiler call");
    const result = next(params.onTokens);
    return result as typeof result & CompilerResult<A, Tools>;
  };
  return { runCompiler, calls };
}

function makeHandler(opts?: {
  onRequestRetry?: (event: TrajectoryArcEvents<TestAgent>["requestRetry"]) => void;
}) {
  const messages: Array<TrajectoryArcIR<TestAgent>> = [];
  const retries: Array<TrajectoryArcEvents<TestAgent>["requestRetry"]> = [];
  const correctedTools: string[] = [];
  const handler: {
    [K in keyof TrajectoryArcEvents<TestAgent>]: (event: TrajectoryArcEvents<TestAgent>[K]) => void;
  } = {
    startResponse: () => {},
    responseProgress: () => {},
    startCompaction: () => {},
    compactionProgress: () => {},
    autofixingJson: () => {},
    autofixingTool: event => {
      correctedTools.push(event.tool);
    },
    requestRetry: event => {
      retries.push(event);
      opts?.onRequestRetry?.(event);
    },
    onMessage: ir => {
      messages.push(ir);
    },
    onResponseHeaders: () => {},
  };
  return { handler, messages, retries, correctedTools };
}

function assistant(opts: {
  content?: string;
  toolCalls?: Array<ToolCall<TestAgent["tools"]> | MalformedToolRequest>;
}): AssistantMessage<TestAgent["tools"]> {
  return {
    role: "assistant",
    content: opts.content ?? "",
    usage: compilerUsage(1, 1),
    toolCalls: opts.toolCalls,
  };
}

function searchCall(query: string, toolCallId = "call-1"): ToolCall<TestAgent["tools"]> {
  return {
    type: "tool-call",
    name: "search",
    toolCallId,
    original: { query },
    parsed: { query },
  };
}

function malformedRequest(): MalformedToolRequest {
  return {
    type: "malformed-tool-request",
    error: "bad json",
    call: { original: { name: "search", arguments: "{oops" } },
    toolCallId: "call-bad",
  };
}

const toolCallResult =
  (query: string): QueueItem =>
  () =>
    ok({
      output: assistant({ toolCalls: [searchCall(query)] }),
      curl: "curl",
      headers: new Headers(),
      usage: compilerUsage(1, 1),
    });

const plainResult: QueueItem = () =>
  ok({
    output: assistant({ content: "done" }),
    curl: "curl",
    headers: new Headers(),
    usage: compilerUsage(1, 1),
  });

const malformedResult: QueueItem = () =>
  ok({
    output: assistant({ toolCalls: [malformedRequest()] }),
    curl: "curl",
    headers: new Headers(),
    usage: compilerUsage(1, 1),
  });

function requestError(message: string): Extract<CompilerError, { type: "request-error" }> {
  return { type: "request-error", requestError: message, curl: "curl" };
}

async function runArc({
  queue,
  toolData = { marker: "fresh" },
  contextWindow = 1_000_000,
  messages,
  errorCorrection,
  validationRetries,
  requestErrorRetries,
  abortController = new AbortController(),
  onRequestRetry,
}: {
  queue: QueueItem[];
  toolData?: TestData;
  contextWindow?: number;
  messages?: Array<LlmIR<TestAgent>>;
  errorCorrection?: ErrorCorrection<TestAgent>;
  validationRetries?: number;
  requestErrorRetries?: RequestErrorRetriesConfig;
  abortController?: AbortController;
  onRequestRetry?: (event: TrajectoryArcEvents<TestAgent>["requestRetry"]) => void;
}) {
  const tools: Partial<LoadedTools<TestAgent["tools"]>> = {};
  const searchDef = await searchTool({
    signal: new AbortController().signal,
    transport,
    data: toolData,
  });
  if (searchDef == null) throw new Error("search tool failed to load");
  tools.search = searchDef;

  const { runCompiler, calls } = makeRunCompiler(queue);
  const rec = makeHandler({ onRequestRetry });
  const base = await trajectoryArc.run<TestAgent, null>({
    model: null,
    contextWindow,
    messages: messages ?? [{ role: "user", content: [{ type: "text", content: "hi" }] }],
    tools,
    toolData,
    runCompiler,
    lowerMessages: msgs => lower<TestAgent>(msgs),
    transport,
    abortSignal: abortController.signal,
    errorCorrection,
    validationRetries,
    requestErrorRetries,
    handler: rec.handler,
  });
  // The budget options are runtime-dynamic in this helper, so any finish reason is possible.
  const finish: TrajectoryArcFinish<AllFinishReasons<TestAgent>> = base;
  return { finish, calls, ...rec };
}

beforeEach(() => {
  validateImpl = () => ok(null);
  dataSeen.length = 0;
});

describe("trajectoryArc", () => {
  it("returns tool calls when validation succeeds, passing tool data to the tool", async () => {
    const { finish, calls, messages } = await runArc({
      queue: [toolCallResult("kittens")],
      toolData: { marker: "validated" },
    });

    expect(finish).toEqual({
      type: "finish",
      reason: {
        type: "request-tool",
        toolCalls: [searchCall("kittens")],
      },
    });
    expect(calls).toEqual([{ irCount: 1, hasTools: true }]);
    expect(messages.map(m => m.role)).toEqual(["assistant"]);
    expect(dataSeen).toEqual([{ marker: "validated" }]);
  });

  it("retries malformed tool calls and finishes needs-response when the retry is clean", async () => {
    const { finish, calls, messages } = await runArc({
      queue: [malformedResult, plainResult],
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls.length).toBe(2);
    expect(messages.map(m => m.role)).toEqual(["assistant", "tool-parse-error", "assistant"]);
  });

  it("finishes with retry-budget-exceeded once the retry budget is spent", async () => {
    const { finish, calls, messages } = await runArc({
      queue: [malformedResult, malformedResult, malformedResult],
      validationRetries: 2,
    });

    expect(finish.reason).toEqual({ type: "validation-retry-budget-exceeded" });
    expect(calls.length).toBe(3);
    expect(messages.filter(m => m.role === "tool-parse-error").length).toBe(3);
  });

  it("retries invalid tool calls with tool-validation-error IRs", async () => {
    validateImpl = query => (query === "bad" ? err("stale") : ok(null));
    const { finish, calls, messages } = await runArc({
      queue: [toolCallResult("bad"), plainResult],
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls.length).toBe(2);
    expect(messages.map(m => m.role)).toEqual(["assistant", "tool-validation-error", "assistant"]);
    const validationError = messages[1];
    if (validationError.role !== "tool-validation-error") throw new Error("impossible");
    expect(validationError.error).toBe("stale");
    expect(validationError.aborted).toBe(false);
  });

  it("applies tool error correction and re-validates the corrected call", async () => {
    validateImpl = query => (query === "bad" ? err("stale") : ok(null));
    const errorCorrection: ErrorCorrection<TestAgent> = {
      tools: {
        search: async ({ toolCall, validationError, data }) => {
          expect(validationError).toBe("stale");
          expect(toolCall.parsed).toEqual({ query: "bad" });
          expect(data).toEqual({ marker: "fresh" });
          return { query: "fixed" };
        },
      },
    };
    const { finish, calls, correctedTools } = await runArc({
      queue: [toolCallResult("bad")],
      errorCorrection,
    });

    expect(finish.reason).toEqual({
      type: "request-tool",
      toolCalls: [{ ...searchCall("bad"), parsed: { query: "fixed" } }],
    });
    expect(calls.length).toBe(1);
    expect(correctedTools).toEqual(["search"]);
    expect(dataSeen.length).toBe(2);
  });

  it("emits tool-validation-error when error correction returns null", async () => {
    validateImpl = query => (query === "bad" ? err("stale") : ok(null));
    const errorCorrection: ErrorCorrection<TestAgent> = {
      tools: {
        search: async () => null,
      },
    };
    const { finish, calls, messages } = await runArc({
      queue: [toolCallResult("bad"), plainResult],
      errorCorrection,
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls.length).toBe(2);
    expect(messages.map(m => m.role)).toEqual(["assistant", "tool-validation-error", "assistant"]);
  });

  it("does not retry request errors when no retries config is passed", async () => {
    const { finish, calls } = await runArc({
      queue: [() => err(requestError("boom"))],
    });

    expect(finish.reason).toEqual({
      type: "request-error",
      requestError: "boom",
      curl: "curl",
    });
    expect(calls.length).toBe(1);
  });

  it("passes through rate limit errors without retrying when no retries config is passed", async () => {
    const { finish, calls } = await runArc({
      queue: [
        () =>
          err({
            type: "rate-limit-error",
            requestError: "slow down",
            curl: "curl",
            headers: new Headers(),
          }),
      ],
    });

    expect(finish.reason.type).toBe("rate-limit-error");
    expect(calls.length).toBe(1);
  });

  it("retries request errors with the configured backoff", async () => {
    const { finish, calls, retries } = await runArc({
      queue: [() => err(requestError("boom")), plainResult],
      requestErrorRetries: { backoffMs: 1 },
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls.length).toBe(2);
    expect(retries.length).toBe(1);
    expect(retries[0].attempt).toBe(1);
    expect(retries[0].delayMs).toBe(1);
    expect(retries[0].error.requestError).toBe("boom");
  });

  it("grows the backoff per attempt, capped at maxBackoffMs", async () => {
    const { finish, calls, retries } = await runArc({
      queue: [
        () => err(requestError("boom")),
        () => err(requestError("boom")),
        () => err(requestError("boom")),
        plainResult,
      ],
      requestErrorRetries: { backoffMs: 1, maxBackoffMs: 2 },
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls.length).toBe(4);
    expect(retries.map(retry => retry.attempt)).toEqual([1, 2, 3]);
    expect(retries.map(retry => retry.delayMs)).toEqual([1, 2, 2]);
  });

  it("gives up retrying request errors after maxRetryCount attempts", async () => {
    const { finish, calls, retries } = await runArc({
      queue: [() => err(requestError("boom")), () => err(requestError("boom"))],
      requestErrorRetries: { maxRetryCount: 1, backoffMs: 1 },
    });

    expect(finish.reason).toEqual({
      type: "request-error-retry-budget-exceeded",
      error: requestError("boom"),
    });
    expect(calls.length).toBe(2);
    expect(retries.length).toBe(1);
  });

  it("finishes with the request error when the retry wait is aborted", async () => {
    const { finish, calls, retries } = await runArc({
      queue: [() => err(requestError("boom")), plainResult],
      requestErrorRetries: { backoffMs: 60_000 },
      onRequestRetry: event => event.abortController.abort(),
    });

    expect(finish.reason).toEqual({
      type: "request-error",
      requestError: "boom",
      curl: "curl",
    });
    expect(calls.length).toBe(1);
    expect(retries.length).toBe(1);
  });

  it("finishes with abort when the arc is aborted during the retry wait", async () => {
    const abortController = new AbortController();
    const { finish, calls } = await runArc({
      queue: [() => err(requestError("boom")), plainResult],
      requestErrorRetries: { backoffMs: 60_000 },
      abortController,
      onRequestRetry: () => abortController.abort(),
    });

    expect(finish.reason).toEqual({ type: "abort" });
    expect(calls.length).toBe(1);
  });

  it("compacts history when the context window is nearly full", async () => {
    const { finish, calls, messages } = await runArc({
      contextWindow: 4,
      messages: [
        {
          role: "user",
          content: [{ type: "text", content: "hello world hello" }],
        },
      ],
      queue: [
        () =>
          ok({
            output: assistant({ content: "summary of the past" }),
            curl: "curl",
            headers: new Headers(),
            usage: compilerUsage(1, 1),
          }),
        plainResult,
      ],
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls).toEqual([
      { irCount: 2, hasTools: false },
      { irCount: 1, hasTools: true },
    ]);
    expect(messages.map(m => m.role)).toEqual(["checkpoint", "assistant"]);
  });

  it("retries request errors from the compaction run", async () => {
    const { finish, calls, retries } = await runArc({
      contextWindow: 4,
      messages: [
        {
          role: "user",
          content: [{ type: "text", content: "hello world hello" }],
        },
      ],
      queue: [
        () => err(requestError("boom")),
        () =>
          ok({
            output: assistant({ content: "summary of the past" }),
            curl: "curl",
            headers: new Headers(),
            usage: compilerUsage(1, 1),
          }),
        plainResult,
      ],
      requestErrorRetries: { backoffMs: 1 },
    });

    expect(finish.reason).toEqual({ type: "needs-response" });
    expect(calls).toEqual([
      { irCount: 2, hasTools: false },
      { irCount: 2, hasTools: false },
      { irCount: 1, hasTools: true },
    ]);
    expect(retries.length).toBe(1);
  });

  it("finishes with abort when the signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const { finish, calls } = await runArc({
      queue: [plainResult],
      abortController,
    });

    expect(finish.reason).toEqual({ type: "abort" });
    expect(calls.length).toBe(0);
  });

  it("emits buffered assistant content when the request fails", async () => {
    const { finish, messages } = await runArc({
      queue: [
        onTokens => {
          onTokens("partial response", "content");
          return err(requestError("boom"));
        },
      ],
    });

    expect(finish.reason.type).toBe("request-error");
    expect(messages).toEqual([
      {
        role: "assistant",
        content: "partial response",
        reasoningContent: undefined,
        usage: compilerUsage(0, 0),
      },
    ]);
  });
});

// Compile-time checks that the run overloads narrow finish reasons by which retry budgets are
// passed. Never executed.
function assertFinishReasonNarrowing() {
  type Includes<T, U> = [T] extends [U] ? true : never;

  const messages: Array<LlmIR<TestAgent>> = [
    { role: "user", content: [{ type: "text", content: "hi" }] },
  ];
  const makeBase = () => ({
    model: null,
    contextWindow: 100,
    messages,
    toolData: { marker: "fresh" },
    transport,
    abortSignal: new AbortController().signal,
  });

  return (async () => {
    const searchDef = await searchTool({
      signal: new AbortController().signal,
      transport,
      data: { marker: "fresh" },
    });
    if (searchDef == null) throw new Error("impossible");
    const base = {
      ...makeBase(),
      tools: { search: searchDef },
      runCompiler: makeRunCompiler([plainResult]).runCompiler,
      lowerMessages: (msgs: Array<LlmIR<TestAgent>>) => lower<TestAgent>(msgs),
      handler: makeHandler({}).handler,
    };

    const none = await trajectoryArc.run<TestAgent, null>(base);
    type NoneReason = (typeof none)["reason"];
    const noValidationBudget: Includes<ValidationRetryBudgetFinishReason, NoneReason> =
      true as never;
    const noRequestBudget: Includes<RequestErrorRetryBudgetFinishReason, NoneReason> =
      true as never;
    const hasStatic: Includes<StaticFinishReasons<TestAgent>, NoneReason> = true;

    const both = await trajectoryArc.run<TestAgent, null>({
      ...base,
      validationRetries: 2,
      requestErrorRetries: { maxRetryCount: 3, backoffMs: 10 },
    });
    type BothReason = (typeof both)["reason"];
    const hasValidationBudget: Includes<ValidationRetryBudgetFinishReason, BothReason> = true;
    const hasRequestBudget: Includes<RequestErrorRetryBudgetFinishReason, BothReason> = true;

    const validationOnly = await trajectoryArc.run<TestAgent, null>({
      ...base,
      validationRetries: 2,
      requestErrorRetries: { backoffMs: 10 },
    });
    type ValidationOnlyReason = (typeof validationOnly)["reason"];
    const onlyValidation: Includes<ValidationRetryBudgetFinishReason, ValidationOnlyReason> = true;
    const stillNoRequest: Includes<RequestErrorRetryBudgetFinishReason, ValidationOnlyReason> =
      true as never;

    return [
      none,
      both,
      validationOnly,
      noValidationBudget,
      noRequestBudget,
      hasStatic,
      hasValidationBudget,
      hasRequestBudget,
      onlyValidation,
      stillNoRequest,
    ];
  })();
}

void assertFinishReasonNarrowing;
