import { describe, expect, it } from "bun:test";
import {
	AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
	AGENTD_TRAJECTORY_ARC_METHOD,
	type AgentdProviderCompilerCompleteResult,
	AgentdRustBridge,
	type AgentdTrajectoryArcResult,
} from "../../../bridge/rust/agent.ts";

type RecordedRequest = {
	method: string;
	params?: unknown;
};

class FakeProcessClient {
	readonly responses: unknown[];
	readonly requests: RecordedRequest[] = [];
	closed = false;
	constructor(responses: unknown[]) {
		this.responses = responses;
	}

	request(method: string, params?: unknown): Promise<unknown> {
		this.requests.push({ method, params });
		return Promise.resolve(this.responses.shift());
	}

	close(): void {
		this.closed = true;
	}
}

describe("AgentdRustBridge provider compiler bridge", () => {
	it("requests agentd provider compiler completion", async () => {
		const response: AgentdProviderCompilerCompleteResult = {
			status: "finished",
			provider: "openai-chat-completions",
			curl: "agentd curl",
			events: [{ type: "token", kind: "content", text: "hello" }],
			state: {
				content: "hello",
				reasoningContent: null,
				usage: {
					input: 4,
					cachedInput: 1,
					output: 2,
					reasoningOutput: 0,
				},
				tools: [],
				openai: {
					reasoningId: null,
					encryptedReasoningContent: null,
				},
				anthropic: {
					thinkingBlocks: [],
				},
			},
			unexpectedToolCall: false,
			output: {
				role: "assistant",
				content: "hello",
				usage: {
					input: { cached: 1, uncached: 3, total: 4 },
					output: 2,
				},
			},
			usage: {
				input: { cached: 1, uncached: 3, total: 4 },
				output: 2,
			},
			headers: { "content-type": "text/event-stream" },
		};
		const processClient = new FakeProcessClient([response]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			type: "standard",
			baseUrl: "https://api.example.test/v1",
			model: "gpt-test",
			context: 128000,
			apiKey: "test-key",
			irs: [{ role: "user", content: [{ type: "text", content: "hello" }] }],
			system: "system prompt",
			tools: [
				{
					name: "read",
					description: "Read a file",
					schema: { type: "object" },
				},
			],
			cwd: "/workspace",
		} as const;

		await expect(bridge.providerCompilerComplete(params)).resolves.toEqual(
			response,
		);
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_PROVIDER_COMPILER_COMPLETE_METHOD,
				params,
			},
		]);
	});

	it("accepts structured agentd provider compiler completion errors", async () => {
		const response: AgentdProviderCompilerCompleteResult = {
			status: "error",
			provider: "openai-chat-completions",
			curl: "agentd curl",
			events: [],
			state: {
				content: "",
				reasoningContent: null,
				usage: {
					input: 0,
					cachedInput: 0,
					output: 0,
					reasoningOutput: 0,
				},
				tools: [],
				openai: {
					reasoningId: null,
					encryptedReasoningContent: null,
				},
				anthropic: {
					thinkingBlocks: [],
				},
			},
			unexpectedToolCall: false,
			output: {
				role: "assistant",
				content: "",
				usage: {
					input: { cached: 0, uncached: 0, total: 0 },
					output: 0,
				},
			},
			usage: {
				input: { cached: 0, uncached: 0, total: 0 },
				output: 0,
			},
			headers: { "x-synthetic-quotas": '{"remaining":0}' },
			error: {
				type: "auth-error",
				requestError: "invalid api key",
				curl: "agentd curl",
				usage: {
					input: { cached: 0, uncached: 0, total: 0 },
					output: 0,
				},
			},
		};
		const processClient = new FakeProcessClient([response]);
		const bridge = new AgentdRustBridge(processClient);

		await expect(
			bridge.providerCompilerComplete({
				type: "standard",
				baseUrl: "https://api.example.test/v1",
				model: "gpt-test",
				context: 128000,
				apiKey: "test-key",
				irs: [],
				cwd: "/workspace",
			}),
		).resolves.toEqual(response);
	});

	it("requests agentd trajectory arc", async () => {
		const response: AgentdTrajectoryArcResult = {
			type: "finish",
			irs: [],
			reason: { type: "abort" },
			events: [],
		};
		const processClient = new FakeProcessClient([response]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			cwd: "/workspace",
			apiKey: "test-key",
			model: {
				type: "standard" as const,
				baseUrl: "https://api.example.test/v1",
				model: "gpt-test",
				context: 128000,
			},
			messages: [],
			config: { yourName: "Test User" },
			aborted: true,
		};

		await expect(bridge.trajectoryArc(params)).resolves.toEqual(response);
		expect(processClient.requests.at(-1)).toEqual({
			method: AGENTD_TRAJECTORY_ARC_METHOD,
			params,
		});
	});
});
