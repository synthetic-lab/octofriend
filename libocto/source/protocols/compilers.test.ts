import { describe, expect, it } from "bun:test";
import { t } from "structural";
import { MockTransport } from "libocto/testing";
import { ok } from "../result.ts";
import { defaultCountTokens } from "../execution.ts";
import type { LoweredIR } from "../llm-ir.ts";
import { protocolUsage } from "./protocol-interface.ts";
import { ToolBuilder } from "../toolkits/tool-def.ts";
import { anthropicCompiler } from "./anthropic/compiler-anthropic.ts";
import { chatCompletionsCompiler } from "./chat-completions/compiler-chat-completions.ts";
import { responsesCompiler } from "./responses/compiler-responses.ts";

type Ir = LoweredIR<{}>;

const model = { model: "test-model", modalities: null };
const irs: Array<Ir> = [{ role: "user", content: [{ type: "text", content: "hello" }] }];

async function searchTools() {
  const controller = new AbortController();
  const transport = new MockTransport({});
  const search = new ToolBuilder<undefined>()
    .declare({
      name: "search",
      description: "Search files",
      ArgumentsSchema: t.subtype({ pattern: t.str, limit: t.optional(t.num) }),
    })
    .define(async () => ({ run: async () => ok({ type: "output", content: [] }) }));
  const loaded = await search({
    signal: controller.signal,
    transport,
    model: {
      provider: null,
      model: "test-model",
      contextWindow: 100_000,
      modalities: null,
      countTokens: defaultCountTokens,
    },
    data: undefined,
  });
  if (loaded == null) throw new Error("Search tool failed to load");
  return { search: loaded };
}

/*
 * Compile-only clients (e.g. hosts that enqueue requests, or SFT data preparation) get a complete
 * provider-native body from the compilers without supplying a client, a backend, or an
 * ExecutionModel. These tests hold that boundary: no network, no transport, no abort signal.
 */
describe("compilers produce complete request bodies", () => {
  it("compiles chat completions requests", async () => {
    const request = await chatCompletionsCompiler({
      model,
      irs,
      systemPrompt: async () => "be helpful",
      config: { reasoningEffort: "high" },
    });

    expect(request.model).toBe("test-model");
    expect(request.messages).toEqual([
      { role: "system", content: "be helpful" },
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(request.reasoning_effort).toBe("high");
    expect(request.stream).toBe(true);
    // Without include_usage, no token counts come back at all.
    expect(request.stream_options).toEqual({ include_usage: true });
    expect(request.tools).toBeUndefined();
  });

  it("compiles anthropic requests", async () => {
    const thinking = { type: "enabled" as const, budget_tokens: 2048 };
    const request = await anthropicCompiler({
      model,
      irs,
      systemPrompt: async () => "be helpful",
      config: { maxTokens: 8192, thinking },
    });

    expect(request.model).toBe("test-model");
    expect(request.system).toBe("be helpful");
    expect(request.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
    expect(request.max_tokens).toBe(8192);
    expect(request.thinking).toEqual(thinking);
    expect(request.tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: false });
    expect(request.stream).toBe(true);
  });

  it("compiles responses requests", async () => {
    const request = await responsesCompiler({
      model,
      irs: [
        ...irs,
        {
          role: "assistant",
          content: "Hello!",
          usage: protocolUsage(1, 1),
          openai: { reasoningId: "rs_1", encryptedReasoningContent: "opaque" },
        },
      ],
      systemPrompt: async () => "be helpful",
      config: { reasoningEffort: "medium" },
    });

    expect(request.model).toBe("test-model");
    expect(request).not.toHaveProperty("instructions");
    expect(request.input).toEqual([
      { role: "developer", content: "be helpful" },
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "opaque" },
      { role: "assistant", content: "Hello!" },
    ]);
    expect(request.reasoning).toEqual({ effort: "medium", summary: "auto" });
    expect(request.store).toBe(false);
    // Without encrypted reasoning content, reasoning can't be replayed next turn.
    expect(request.include).toEqual(["reasoning.encrypted_content"]);
    expect(request.stream).toBe(true);
  });

  it("does not insert a developer message when no Responses prompt is supplied", async () => {
    const request = await responsesCompiler({ model, irs });
    expect(request).not.toHaveProperty("instructions");
    expect(request.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ]);
  });

  it("compiles tool definitions alongside messages", async () => {
    const tools = await searchTools();

    const chat = await chatCompletionsCompiler({ model, irs, tools });
    const [chatTool] = chat.tools ?? [];
    if (chatTool?.type !== "function") throw new Error("Expected a function tool");
    expect(chatTool.function.name).toBe("search");
    expect(chatTool.function.strict).toBe(true);
    expect(chatTool.function.parameters).not.toHaveProperty("$schema");
    expect(chatTool.function.parameters).toHaveProperty("properties.pattern");

    const anthropic = await anthropicCompiler({
      model,
      irs,
      tools,
      config: { maxTokens: 4096 },
    });
    const anthropicTools = anthropic.tools ?? [];
    const [anthropicTool] = anthropicTools;
    if (anthropicTool == null || !("input_schema" in anthropicTool)) {
      throw new Error("Expected a custom tool");
    }
    expect(anthropicTool.name).toBe("search");
    expect(anthropicTool.input_schema).not.toHaveProperty("$schema");
  });

  it("closes object schemas for responses strict mode", async () => {
    const tools = await searchTools();
    const responses = await responsesCompiler({ model, irs, tools });
    const [tool] = responses.tools ?? [];
    if (tool == null || tool.type !== "function") throw new Error("Expected a function tool");

    const parameters = tool.parameters as Record<string, unknown>;
    expect(tool.strict).toBe(true);
    expect(parameters["additionalProperties"]).toBe(false);
    // Strict mode makes the optional `limit` required, modelling it as nullable.
    expect(parameters["required"]).toEqual(["pattern", "limit"]);
  });

  it("produces bodies that survive serialization for a queue", async () => {
    const tools = await searchTools();
    const request = await chatCompletionsCompiler({
      model,
      irs,
      tools,
      systemPrompt: async () => "be helpful",
    });
    expect(JSON.parse(JSON.stringify(request))).toEqual(request);
  });
});
