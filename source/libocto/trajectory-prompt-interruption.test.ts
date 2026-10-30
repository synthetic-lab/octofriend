import { describe, expect, it } from "bun:test";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { systemPrompt } from "../prompts/system-prompt.ts";
import { MockTransport } from "../transports/mock.ts";
import { AbortError } from "../transports/transport-common.ts";
import { runAnthropicAgent } from "./compilers/anthropic.ts";
import type { Compiler } from "./compilers/compiler-interface.ts";
import { runResponsesAgent } from "./compilers/responses.ts";
import { runAgent } from "./compilers/standard.ts";
import { definePermissionlessAgent, type AgentIR } from "./llm-ir.ts";
import { ok } from "./result.ts";
import { Trajectory } from "./trajectory.ts";

const providers = ["standard", "responses", "anthropic"] as const;
type Provider = (typeof providers)[number];
const agent = definePermissionlessAgent({ tools: {}, agents: {} });

function fixture(provider: Provider, transport: MockTransport) {
  let networkCalls = 0;
  const fetch = async () => {
    networkCalls++;
    throw new Error("No provider request should be made during prompt preparation");
  };
  const openai = new OpenAI({ apiKey: "test", maxRetries: 0, fetch });
  const anthropic = new Anthropic({ apiKey: "test", maxRetries: 0, fetch });
  const runCompiler: Compiler<null> = params => {
    switch (provider) {
      case "standard":
        return runAgent({ ...params, model: { client: openai, model: "test" } });
      case "responses":
        return runResponsesAgent({ ...params, model: { client: openai, model: "test" } });
      case "anthropic":
        return runAnthropicAgent({
          ...params,
          model: { client: anthropic, model: "test", maxTokens: 100 },
        });
    }
  };
  const commits: Array<Array<AgentIR<typeof agent>>> = [];
  const messages: Array<AgentIR<typeof agent>> = [
    { role: "user", content: [{ type: "text", content: "Hello" }] },
  ];
  let rollbacks = 0;
  const trajectory = new Trajectory({
    agent,
    messages,
    model: async () => ok({ model: null, contextWindow: 100_000, modalities: null }),
    loadTools: async () => ok({}),
    toolData: undefined,
    toolContentTooLargeError: async () => "Unexpected oversized output",
    runCompiler,
    systemPrompt: signal => {
      return systemPrompt({ config: { yourName: "Test", models: [] }, transport, signal });
    },
    lowerMessages: irs => irs.map(original => ({ original, converted: original })),
    subagentPrompts: {},
    transport,
    abortSignal: new AbortController().signal,
    loopController: async step => {
      await step();
    },
    handler: {
      onMessages: event => {
        commits.push(event.irs);
      },
      discardResponseProgress: () => {
        rollbacks++;
      },
    },
  });
  return {
    trajectory,
    commits,
    messages,
    networkCalls: () => networkCalls,
    rollbacks: () => rollbacks,
  };
}

for (const provider of providers) {
  describe(`${provider} prompt preparation`, () => {
    it.each([
      { name: "transport AbortError", error: new AbortError() },
      { name: "DOM AbortError", error: new DOMException("Aborted", "AbortError") },
    ])(
      "finalizes interruption when ESC cancels an awaited prompt with $name",
      async ({ error }) => {
        const transport = new MockTransport({});
        let entered!: () => void;
        const promptEntered = new Promise<void>(resolve => {
          entered = resolve;
        });
        transport.shell = async signal => {
          return new Promise<string>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(error), { once: true });
            entered();
          });
        };
        const recording = fixture(provider, transport);
        const running = recording.trajectory.run();
        await promptEntered;
        expect(recording.trajectory.messages).toEqual(recording.messages);
        expect(recording.commits).toEqual([]);
        const mode = recording.trajectory.mode;
        if (mode.mode !== "responding") throw new Error("Expected response mode");
        await mode.control.interrupt();
        await expect(running).resolves.toBeUndefined();

        const snapshot: Array<AgentIR<typeof agent>> = [
          { role: "request-snapshot-begin", retryBudget: { validation: null, requestError: 0 } },
          { role: "interrupted-by-user", reason: "The user interrupted the response." },
          { role: "request-snapshot-end" },
        ];
        expect(recording.commits).toEqual([snapshot]);
        expect(recording.trajectory.messages).toEqual([...recording.messages, ...snapshot]);
        expect(recording.rollbacks()).toBe(1);
        expect(recording.networkCalls()).toBe(0);
      },
    );

    it.each([
      { name: "ordinary failure", error: new Error("prompt preparation failed") },
      { name: "AbortError without cancellation", error: new AbortError() },
    ])("does not hide $name while the request signal is live", async ({ error }) => {
      const transport = new MockTransport({});
      transport.shell = async () => {
        throw error;
      };
      const recording = fixture(provider, transport);
      await expect(recording.trajectory.run()).rejects.toBe(error);
      expect(recording.trajectory.messages).toEqual(recording.messages);
      expect(recording.commits).toEqual([]);
      expect(recording.rollbacks()).toBe(0);
      expect(recording.networkCalls()).toBe(0);
    });
  });
}
