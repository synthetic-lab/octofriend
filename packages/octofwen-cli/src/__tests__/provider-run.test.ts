import { describe, expect, it } from "bun:test";
import type { AgentdRustBridge } from "../bridge/rust/agent.ts";
import type {
	AgentdProviderCompilerCompleteParams,
	AgentdProviderCompilerCompleteResult,
	AgentdProviderStreamEvent,
} from "../bridge/rust/provider-runtime.ts";
import type { Config } from "../configuration/schemas.ts";
import {
	replayProviderTokenEvents,
	runCliProviderCompletion,
	type CliProviderMessage,
} from "../provider-run.ts";

const emptyAssistantUsage = {
	input: { cached: 0, uncached: 0, total: 0 },
	output: 0,
};

const emptyStreamUsage = {
	input: 0,
	cachedInput: 0,
	output: 0,
	reasoningOutput: 0,
};

function finishedResult(
	events: readonly AgentdProviderStreamEvent[] = [],
): Extract<AgentdProviderCompilerCompleteResult, { status: "finished" }> {
	return {
		status: "finished",
		provider: "test-provider",
		curl: "curl test",
		events,
		state: {
			content: "",
			reasoningContent: "",
			usage: emptyStreamUsage,
			tools: [],
			openai: {},
			anthropic: { thinkingBlocks: [] },
		},
		unexpectedToolCall: false,
		output: { role: "assistant", content: "", usage: emptyAssistantUsage },
		usage: emptyAssistantUsage,
		headers: {},
	};
}

class FakeBridge {
	readonly requests: AgentdProviderCompilerCompleteParams[] = [];

	constructor(private readonly response: AgentdProviderCompilerCompleteResult) {}

	providerCompilerComplete(params: AgentdProviderCompilerCompleteParams) {
		this.requests.push(params);
		return Promise.resolve(this.response);
	}
}

function asBridge(fake: FakeBridge): AgentdRustBridge {
	return fake as unknown as AgentdRustBridge;
}


type TestResult<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

function expectOk<T, E>(result: TestResult<T, E>): T {
	expect(result.success).toBe(true);
	return result.success ? result.data : (undefined as T);
}

const messages: CliProviderMessage[] = [
	{ role: "user", content: [{ type: "text", content: "hello" }] },
];

describe("runCliProviderCompletion", () => {
	it("passes Anthropic provider type and thinking budget fields to agentd", async () => {
		const bridge = new FakeBridge(finishedResult());
		const model: Config["models"][number] = {
			type: "anthropic",
			nickname: "claude",
			baseUrl: "https://api.anthropic.test",
			model: "claude-test",
			context: 200_000,
			reasoning: "xhigh",
			thinkingBudgetTokens: 12_000,
		};

		expectOk(await runCliProviderCompletion({
			bridge: asBridge(bridge),
			apiKey: "anthropic-key",
			model,
			messages,
			system: "system prompt",
			cwd: "/workspace",
		}));

		expect(bridge.requests).toEqual([
			{
				type: "anthropic",
				baseUrl: "https://api.anthropic.test",
				model: "claude-test",
				context: 200_000,
				reasoning: "xhigh",
				thinkingBudgetTokens: 12_000,
				modalities: undefined,
				apiKey: "anthropic-key",
				irs: messages,
				system: "system prompt",
				cwd: "/workspace",
			},
		]);
	});

	it("passes OpenAI Responses provider type, reasoning, and modalities to agentd", async () => {
		const bridge = new FakeBridge(finishedResult());
		const modalities = {
			image: {
				enabled: true,
				maxSizeMB: 20,
				acceptedMimeTypes: ["image/png"],
			},
		};
		const model: Config["models"][number] = {
			type: "openai-responses",
			nickname: "gpt",
			baseUrl: "https://api.openai.test",
			model: "gpt-test",
			context: 128_000,
			reasoning: "minimal",
			modalities,
		};

		expectOk(await runCliProviderCompletion({
			bridge: asBridge(bridge),
			apiKey: "openai-key",
			model,
			messages,
			cwd: "/workspace",
		}));

		expect(bridge.requests).toEqual([
			{
				type: "openai-responses",
				baseUrl: "https://api.openai.test",
				model: "gpt-test",
				context: 128_000,
				reasoning: "minimal",
				thinkingBudgetTokens: undefined,
				modalities,
				apiKey: "openai-key",
				irs: messages,
				system: undefined,
				cwd: "/workspace",
			},
		]);
	});

	it("passes Gemini provider type to agentd", async () => {
		const bridge = new FakeBridge(finishedResult());
		const model: Config["models"][number] = {
			type: "gemini",
			nickname: "gemini",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			model: "gemini-3.5-flash",
			context: 1_048_576,
		};

		expectOk(await runCliProviderCompletion({
			bridge: asBridge(bridge),
			apiKey: "gemini-key",
			model,
			messages,
			system: "system prompt",
			cwd: "/workspace",
		}));

		expect(bridge.requests).toEqual([
			{
				type: "gemini",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				model: "gemini-3.5-flash",
				context: 1_048_576,
				reasoning: undefined,
				thinkingBudgetTokens: undefined,
				modalities: undefined,
				apiKey: "gemini-key",
				irs: messages,
				system: "system prompt",
				cwd: "/workspace",
			},
		]);
	});

	it("returns the provider request error when agentd returns an error", async () => {
		const bridge = new FakeBridge({
			...finishedResult(),
			status: "error",
			error: {
				type: "request-error",
				requestError: "provider failed",
				curl: "curl test",
				usage: emptyAssistantUsage,
			},
		});
		const model: Config["models"][number] = {
			nickname: "standard",
			baseUrl: "https://api.example.test",
			model: "model-test",
			context: 32_000,
		};

		const result = await runCliProviderCompletion({
			bridge: asBridge(bridge),
			apiKey: "key",
			model,
			messages,
			cwd: "/workspace",
		});

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toBe("provider failed");
	});
});

describe("replayProviderTokenEvents", () => {
	it("streams only token events in provider order with reasoning/content/tool kinds", () => {
		const tokens: Array<{ text: string; kind: "content" | "reasoning" | "tool" }> = [];

		replayProviderTokenEvents(
			finishedResult([
				{ type: "token", kind: "reasoning", text: "thinking" },
				{
					type: "usage",
					input: 1,
					cachedInput: 0,
					output: 2,
					reasoningOutput: 3,
				},
				{ type: "token", kind: "content", text: "answer" },
				{ type: "tool-delta", index: 0, arguments: "{}" },
				{ type: "token", kind: "tool", text: "tool-json" },
			]),
			(text, kind) => tokens.push({ text, kind }),
		);

		expect(tokens).toEqual([
			{ text: "thinking", kind: "reasoning" },
			{ text: "answer", kind: "content" },
			{ text: "tool-json", kind: "tool" },
		]);
	});
});
