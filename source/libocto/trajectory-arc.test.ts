import { beforeEach, describe, expect, it } from "bun:test";
import { t } from "structural";
import { LocalTransport } from "../transports/local.ts";
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
import { lower } from "./ir-operations.ts";
import { requestSnapshot } from "./request-snapshot.ts";
import { trajectoryArc, type ErrorCorrection, type TrajectoryArcEvents } from "./trajectory-arc.ts";

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
const _testAgent = defineAgent({ tools: { search: searchTool }, agents: {} });
type TestAgent = typeof _testAgent;
const transport = new LocalTransport();
type Emit = (tokens: string, type: "reasoning" | "content") => Promise<void>;
type QueueItem = (
  onTokens: Emit,
) =>
  | Result<CompilerSuccessData<TestAgent>, CompilerError>
  | Promise<Result<CompilerSuccessData<TestAgent>, CompilerError>>;

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
  return { type: "tool-call", name: "search", toolCallId, original: { query }, parsed: { query } };
}
function malformedRequest(): MalformedToolRequest {
  return {
    type: "malformed-tool-request",
    error: "bad json",
    call: { original: { name: "search", arguments: "{oops" } },
    toolCallId: "call-bad",
  };
}
function result(output: AssistantMessage<TestAgent["tools"]>): QueueItem {
  return () => ok({ output, curl: "curl", headers: new Headers(), usage: compilerUsage(1, 1) });
}
function requestError(message: string): Extract<CompilerError, { type: "request-error" }> {
  return { type: "request-error", requestError: message, curl: "curl" };
}

async function runArc(opts: {
  response: QueueItem;
  toolData?: TestData;
  messages?: Array<LlmIR<TestAgent>>;
  errorCorrection?: ErrorCorrection<TestAgent>;
  abortController?: AbortController;
}) {
  const toolData = opts.toolData ?? { marker: "fresh" };
  const abortController = opts.abortController ?? new AbortController();
  const search = await searchTool({ signal: abortController.signal, transport, data: toolData });
  if (search == null) throw new Error("search tool failed to load");
  const runCompiler: Compiler<null> = async <
    A extends Agent<any, any, any>,
    Tools extends Partial<LoadedTools<A["tools"]>> | undefined = undefined,
  >(
    params: CompilerParams<A, null, Tools>,
  ): Promise<CompilerResult<A, Tools>> => {
    const compiled = await opts.response(params.onTokens);
    return compiled as typeof compiled & CompilerResult<A, Tools>;
  };
  const correctedTools: string[] = [];
  const rollbacks: null[] = [];
  const handler: {
    [K in keyof TrajectoryArcEvents]: (event: TrajectoryArcEvents[K]) => Promise<void>;
  } = {
    startResponse: async () => {},
    responseProgress: async () => {},
    discardResponseProgress: async () => {
      rollbacks.push(null);
    },
    autofixingJson: async () => {},
    autofixingTool: async event => {
      correctedTools.push(event.tool);
    },
    onResponseHeaders: async () => {},
  };
  const messages = await trajectoryArc.run<TestAgent, null>({
    model: null,
    messages: opts.messages ?? [{ role: "user", content: [{ type: "text", content: "hi" }] }],
    tools: { search },
    toolData,
    runCompiler,
    lowerMessages: msgs => {
      return lower<TestAgent>(
        msgs.map(original => ({ original, converted: original })),
        { validation: 0, requestError: 0 },
      );
    },
    transport,
    abortSignal: abortController.signal,
    errorCorrection: opts.errorCorrection,
    handler,
  });
  return { messages, correctedTools, rollbacks };
}

beforeEach(() => {
  validateImpl = () => ok(null);
  dataSeen.length = 0;
});

describe("trajectoryArc", () => {
  it("returns validated calls in a complete snapshot and supplies tool data", async () => {
    const output = assistant({ toolCalls: [searchCall("kittens")] });
    const { messages } = await runArc({
      response: result(output),
      toolData: { marker: "validated" },
    });
    expect(messages).toEqual(requestSnapshot([output]));
    expect(dataSeen).toEqual([{ marker: "validated" }]);
  });

  it.each(["malformed", "invalid"] as const)(
    "returns the whole %s batch with sibling answers",
    async kind => {
      validateImpl = query => (query === "bad" ? err("invalid query") : ok(null));
      const failedCall = kind === "malformed" ? malformedRequest() : searchCall("bad");
      const sibling = searchCall("sibling", "c2");
      const output = assistant({ toolCalls: [failedCall, sibling] });
      const { messages } = await runArc({ response: result(output) });
      expect(messages.map(ir => ir.role)).toEqual([
        "request-snapshot-begin",
        "assistant",
        kind === "malformed" ? "tool-parse-error" : "tool-validation-error",
        "tool-skip-output",
        "request-snapshot-end",
      ]);
      expect(messages[1]).toBe(output);
      expect(messages[3]).toMatchObject({ role: "tool-skip-output", toolCall: sibling });
    },
  );

  it("applies correction and revalidates before returning a successful request", async () => {
    validateImpl = query => (query === "bad" ? err("stale") : ok(null));
    const output = assistant({ toolCalls: [searchCall("bad")] });
    const { messages, correctedTools } = await runArc({
      response: result(output),
      errorCorrection: {
        tools: {
          search: async ({ validationError, data }) => {
            expect(validationError).toBe("stale");
            expect(data).toEqual({ marker: "fresh" });
            return { query: "fixed" };
          },
        },
      },
    });
    expect(messages).toEqual(requestSnapshot([output]));
    expect(output.toolCalls?.[0]).toMatchObject({
      original: { query: "bad" },
      parsed: { query: "fixed" },
    });
    expect(correctedTools).toEqual(["search"]);
    expect(dataSeen).toHaveLength(2);
  });

  it("returns the validation failure when correction returns null", async () => {
    validateImpl = () => err("stale");
    const output = assistant({ toolCalls: [searchCall("bad")] });
    const { messages } = await runArc({
      response: result(output),
      errorCorrection: { tools: { search: async () => null } },
    });
    expect(messages).toEqual(
      requestSnapshot([
        output,
        {
          role: "tool-validation-error",
          toolCall: searchCall("bad"),
          error: "stale",
          aborted: false,
        },
      ]),
    );
  });

  it.each([
    "request-error",
    "stream-error",
    "rate-limit-error",
    "auth-error",
    "payment-error",
  ] as const)("maps compiler %s to its persisted error snapshot", async type => {
    const error: CompilerError =
      type === "auth-error"
        ? { type, authError: "no key" }
        : {
            type,
            requestError: "failed",
            curl: "curl",
            headers: new Headers(),
            usage: compilerUsage(1, 1),
          };
    const { messages } = await runArc({ response: () => err(error) });
    expect(messages).toEqual(
      requestSnapshot([
        type === "auth-error"
          ? { role: "auth-error", authError: "no key" }
          : type === "payment-error" || type === "rate-limit-error"
            ? { role: type, requestError: "failed" }
            : { role: "request-error", requestError: "failed", curl: "curl" },
      ]),
    );
  });

  it("returns partial content together with its error, without changing history during progress", async () => {
    const history: Array<LlmIR<TestAgent>> = [{ role: "user", content: [] }];
    const { messages } = await runArc({
      messages: history,
      response: async emit => {
        await emit("partial response", "content");
        expect(history).toEqual([{ role: "user", content: [] }]);
        return err(requestError("boom"));
      },
    });
    expect(messages).toEqual(
      requestSnapshot([
        {
          role: "assistant",
          content: "partial response",
          reasoningContent: undefined,
          usage: compilerUsage(0, 0),
        },
        { role: "request-error", requestError: "boom", curl: "curl" },
      ]),
    );
    expect(history).toHaveLength(1);
  });

  it.each(["reasoning", "content"] as const)("finalizes an interrupted %s stream", async type => {
    const abortController = new AbortController();
    const { messages, rollbacks } = await runArc({
      abortController,
      response: async emit => {
        await emit("partial", type);
        abortController.abort();
        return result(assistant({ content: "unreached" }))(emit);
      },
    });
    expect(messages).toEqual(
      type === "content"
        ? requestSnapshot([
            {
              role: "assistant",
              content: "partial",
              reasoningContent: undefined,
              usage: compilerUsage(0, 0),
            },
            { role: "interrupted-by-user", reason: "The user interrupted the response." },
          ])
        : requestSnapshot([
            { role: "interrupted-by-user", reason: "The user interrupted the response." },
          ]),
    );
    expect(rollbacks).toHaveLength(type === "reasoning" ? 1 : 0);
  });

  it("answers every sibling before returning an interrupted correction", async () => {
    validateImpl = () => err("stale");
    const abortController = new AbortController();
    const { messages } = await runArc({
      abortController,
      response: result(assistant({ toolCalls: [searchCall("bad"), searchCall("sibling", "c2")] })),
      errorCorrection: {
        tools: {
          search: async () => {
            abortController.abort();
            return null;
          },
        },
      },
    });
    expect(messages.map(ir => ir.role)).toEqual([
      "request-snapshot-begin",
      "assistant",
      "tool-validation-error",
      "tool-skip-output",
      "interrupted-by-user",
      "request-snapshot-end",
    ]);
    expect(messages[2]).toMatchObject({
      role: "tool-validation-error",
      aborted: true,
      toolCall: { toolCallId: "call-1" },
    });
    expect(messages[3]).toMatchObject({ role: "tool-skip-output", toolCall: { toolCallId: "c2" } });
  });
});
