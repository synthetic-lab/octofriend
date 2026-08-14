import { describe, expect, it } from "bun:test";
import OpenAI from "openai";
import { octoAgent } from "../../ir/octo-ir.ts";
import type { Transport } from "../../transports/transport-common.ts";
import { runResponsesAgent, toResponseInput } from "./responses.ts";
import {
  normalizeOpenAIStrictFunctionArguments,
  openAIStrictFunctionParameters,
} from "./responses.ts";
import { compilerUsage } from "./compiler-interface.ts";
import type { LoweredIR } from "../llm-ir.ts";
import type { ToolCall } from "../tool-def.ts";
import type toolMap from "../../tools/tool-defs/index.ts";

describe("openAIStrictFunctionParameters", () => {
  it("closes object schemas for OpenAI strict function calling", () => {
    const strict = openAIStrictFunctionParameters({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "ignore",
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
      },
    });

    expect(strict).toEqual({
      type: "object",
      required: ["filePath"],
      properties: {
        filePath: { type: "string" },
      },
      additionalProperties: false,
    });
  });

  it("turns optional object properties into nullable required properties", () => {
    const schema = {
      type: "object",
      required: [],
      properties: {
        dirPath: { type: "string" },
      },
    };
    const strict = openAIStrictFunctionParameters(schema);

    expect(strict).toEqual({
      type: "object",
      required: ["dirPath"],
      properties: {
        dirPath: { type: ["string", "null"] },
      },
      additionalProperties: false,
    });
    expect(
      normalizeOpenAIStrictFunctionArguments(schema, {
        dirPath: null,
      }),
    ).toEqual({});
  });

  it("does not delete real non-null optional values", () => {
    const schema = {
      type: "object",
      required: [],
      properties: {
        dirPath: { type: "string" },
      },
    };

    expect(normalizeOpenAIStrictFunctionArguments(schema, { dirPath: "." })).toEqual({
      dirPath: ".",
    });
  });

  it("preserves dictionary schemas while lowering nested optional fields", () => {
    const strict = openAIStrictFunctionParameters({
      type: "object",
      required: [],
      properties: {
        args: {
          type: "object",
          properties: {},
          additionalProperties: { type: "string" },
        },
      },
    });

    expect(strict).toEqual({
      type: "object",
      required: ["args"],
      properties: {
        args: {
          type: ["object", "null"],
          properties: {},
          required: [],
          additionalProperties: { type: "string" },
        },
      },
      additionalProperties: false,
    });
  });

  it("adds type hints for string enums", () => {
    const strict = openAIStrictFunctionParameters({
      type: "object",
      required: ["skillName"],
      properties: {
        skillName: { enum: ["planner", "reviewer"] },
      },
    });

    expect(strict).toEqual({
      type: "object",
      required: ["skillName"],
      properties: {
        skillName: {
          type: "string",
          enum: ["planner", "reviewer"],
        },
      },
      additionalProperties: false,
    });
  });
});

describe("runResponsesAgent", () => {
  it("returns an error if a model calls a tool when no tools were provided", async () => {
    const client = new OpenAI({ apiKey: "test" });
    const headers = new Headers({ "x-test-header": "present" });
    Object.defineProperty(client, "responses", {
      value: {
        create: () => ({
          withResponse: async () => ({
            data: (async function* () {
              yield {
                type: "response.function_call_arguments.delta",
                delta: "{}",
              };
              yield {
                type: "response.completed",
                response: {
                  output: [],
                  usage: {
                    input_tokens: 1,
                    input_tokens_details: { cached_tokens: 0 },
                    output_tokens: 1,
                    output_tokens_details: { reasoning_tokens: 0 },
                  },
                },
              };
            })(),
            response: { headers },
          }),
        }),
      },
    });

    const result = await runResponsesAgent<typeof octoAgent>({
      model: {
        client,
        model: "test-model",
      },
      irs: [
        {
          role: "user",
          content: [{ type: "text", content: "hello" }],
        },
      ],
      onTokens: () => {},
      abortSignal: new AbortController().signal,
      transport: fakeTransport(),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe("unexpected-tool-call");
      if (result.error.type !== "unexpected-tool-call") return;
      expect(result.error.headers?.get("x-test-header")).toBe("present");
      expect("usage" in result.error ? result.error.usage : null).toEqual({
        input: { cached: 0, uncached: 1, total: 1 },
        output: 1,
      });
    }
  });
});

type ShellToolCall = Extract<ToolCall<typeof toolMap>, { name: "shell" }>;
type Ir = LoweredIR<typeof toolMap>;

function shellCall(id: string, cmd: string): ShellToolCall {
  return {
    type: "tool-call",
    name: "shell",
    toolCallId: id,
    original: { cmd, timeout: 60_000 },
    parsed: { cmd, timeout: 60_000 },
  };
}

function assistantWith(calls: ShellToolCall[]): Ir {
  return {
    role: "assistant",
    content: "On it.",
    usage: compilerUsage(0, 0),
    toolCalls: calls,
  };
}

function outputFor(call: ShellToolCall, output = "done"): Ir {
  return {
    role: "tool-output",
    toolCall: call,
    content: [{ type: "text", content: output }],
  };
}

type TraceEntry =
  | { kind: "call"; callId: string }
  | { kind: "output"; callId: string; output: string }
  | { kind: "other" };

async function trace(messages: Ir[]): Promise<TraceEntry[]> {
  const input = await toResponseInput<typeof octoAgent>(messages);
  return input.map(item => {
    if (item.type === "function_call") {
      return { kind: "call", callId: item.call_id };
    }
    if (item.type === "function_call_output") {
      return { kind: "output", callId: item.call_id, output: item.output };
    }
    return { kind: "other" };
  });
}

function outputsOf(traceEntries: TraceEntry[]): Array<Extract<TraceEntry, { kind: "output" }>> {
  return traceEntries.filter(
    (entry): entry is Extract<TraceEntry, { kind: "output" }> => entry.kind === "output",
  );
}

describe("toResponseInput tool-call answering", () => {
  it("synthesizes a skip output for an unanswered tool call", async () => {
    const callA = shellCall("call_a", "echo a");
    const result = outputsOf(await trace([assistantWith([callA])]));
    expect(result).toEqual([{ kind: "output", callId: "call_a", output: expect.any(String) }]);
    expect(result[0].output).toContain("skipped");
  });

  it("keeps real outputs and synthesizes nothing when calls are answered", async () => {
    const callA = shellCall("call_a", "echo a");
    const result = outputsOf(await trace([assistantWith([callA]), outputFor(callA)]));
    expect(result).toEqual([{ kind: "output", callId: "call_a", output: "done" }]);
  });

  it("emits outputs in tool-call order, synthesizing gaps in order", async () => {
    const callA = shellCall("call_a", "echo a");
    const callB = shellCall("call_b", "echo b");
    const callC = shellCall("call_c", "echo c");
    const result = outputsOf(
      await trace([assistantWith([callA, callB, callC]), outputFor(callA), outputFor(callC)]),
    );
    expect(result.map(entry => entry.callId)).toEqual(["call_a", "call_b", "call_c"]);
    expect(result[0].output).toBe("done");
    expect(result[1].output).toContain("skipped");
    expect(result[2].output).toBe("done");
  });

  /*
   * Regression test: call IDs are only unique within a single response, and providers may
   * recycle them across turns. A stale output from an earlier batch must not suppress synthesis
   * for a later, genuinely unanswered call that reuses the ID — the Responses API rejects
   * requests with unanswered function calls.
   */
  it("synthesizes for a later batch that reuses an earlier batch's IDs", async () => {
    const firstBatchCall = shellCall("call_0", "echo first");
    const secondBatchCall = shellCall("call_0", "echo second");
    const result = outputsOf(
      await trace([
        assistantWith([firstBatchCall]),
        outputFor(firstBatchCall, "first output"),
        assistantWith([secondBatchCall]),
      ]),
    );
    expect(result.map(entry => entry.callId)).toEqual(["call_0", "call_0"]);
    expect(result[0].output).toBe("first output");
    expect(result[1].output).toContain("skipped");
  });

  it("drops outputs with no originating tool call", async () => {
    const orphan = shellCall("call_orphan", "echo orphan");
    expect(await trace([outputFor(orphan)])).toEqual([]);
  });

  it("throws on orphan outputs in canary builds", async () => {
    const orphan = shellCall("call_orphan", "echo orphan");
    const prevCanary = process.env["CANARY_OCTO"];
    process.env["CANARY_OCTO"] = "1";
    try {
      await expect(trace([outputFor(orphan)])).rejects.toThrow("no originating tool call");
    } finally {
      if (prevCanary == null) delete process.env["CANARY_OCTO"];
      else process.env["CANARY_OCTO"] = prevCanary;
    }
  });
});

function fakeTransport(): Transport {
  return {
    cwd: ".",
    writeFile: async () => {},
    readFile: async () => "",
    pathExists: async () => false,
    isDirectory: async () => false,
    mkdir: async () => {},
    readdir: async () => [],
    modTime: async () => 0,
    resolvePath: async (_signal, path) => path,
    shell: async () => "",
    close: async () => {},
  };
}
