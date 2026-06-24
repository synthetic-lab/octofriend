import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { octoAgent } from "../../ir/octo-ir.ts";
import type { Transport } from "../../transports/transport-common.ts";
import { runResponsesAgent } from "./responses.ts";
import {
  normalizeOpenAIStrictFunctionArguments,
  openAIStrictFunctionParameters,
} from "./responses.ts";

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
