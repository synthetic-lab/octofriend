import { describe, expect, it } from "bun:test";
import type { BunPipeProcess } from "../../../bridge/node/platform.ts";
import {
	AGENTD_AUTOFIX_EDIT_METHOD,
	AGENTD_AUTOFIX_JSON_METHOD,
	AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
	AGENTD_COMPACTION_DECISION_METHOD,
	AGENTD_COMPACTION_PREPARE_METHOD,
	AGENTD_INITIALIZE_METHOD,
	AGENTD_MODEL_CONNECTION_TEST_METHOD,
	AGENTD_OCTO_LOWER_METHOD,
	AGENTD_RENDER_TOOL_CALL_METHOD,
	AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD,
	AGENTD_SYSTEM_PROMPT_METHOD,
	AGENTD_TOOL_DEFINITIONS_METHOD,
	AGENTD_TRAJECTORY_FINISH_METHOD,
	AgentdRustBridge,
	createAgentdRustBridge,
	spawnAgentdProcessClient,
} from "../../../bridge/rust/agent.ts";
import type { AgentdTrajectoryFinishResult } from "../../../bridge/rust/trajectory-finish.ts";

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

function inertProcess(): BunPipeProcess {
	return {
		stdin: {
			write() {
				return 0;
			},
		},
		stdout: new ReadableStream<Uint8Array>(),
		stderr: new ReadableStream<Uint8Array>(),
		kill() {
			return;
		},
	};
}

describe("AgentdRustBridge", () => {
	it("initializes the agent daemon through the process client", async () => {
		const processClient = new FakeProcessClient([
			{
				serverInfo: { name: "octofwen-agentd", version: "0.0.0" },
				capabilities: { renderModels: true },
			},
		]);
		const bridge = new AgentdRustBridge(processClient);

		await expect(bridge.initialize()).resolves.toEqual({
			serverInfo: { name: "octofwen-agentd", version: "0.0.0" },
			capabilities: { renderModels: true },
		});
		expect(processClient.requests).toEqual([
			{ method: AGENTD_INITIALIZE_METHOD },
		]);
	});

	it("requests structured agentd render models for tool calls", async () => {
		const processClient = new FakeProcessClient([
			{ kind: "shell", title: "shell", subject: "pwd", details: [] },
		]);
		const bridge = new AgentdRustBridge(processClient);

		await expect(
			bridge.renderToolCall("shell", { cmd: "pwd", timeout: 5000 }),
		).resolves.toEqual({
			kind: "shell",
			title: "shell",
			subject: "pwd",
			details: [],
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_RENDER_TOOL_CALL_METHOD,
				params: { name: "shell", arguments: { cmd: "pwd", timeout: 5000 } },
			},
		]);
	});

	it("requests agentd system prompts", async () => {
		const processClient = new FakeProcessClient([
			{ prompt: "agentd system prompt" },
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			userName: "Krystian",
			workingDirectory: "/workspace",
			directoryEntries: [{ entry: "package.json", isDirectory: false }],
			mcpPrompt: "",
			instructionPrompt: "Use Bun",
		};

		await expect(bridge.systemPrompt(params)).resolves.toEqual({
			prompt: "agentd system prompt",
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_SYSTEM_PROMPT_METHOD,
				params,
			},
		]);
	});

	it("requests agentd compaction decisions", async () => {
		const processClient = new FakeProcessClient([
			{
				shouldCompact: true,
				estimatedTokens: 91,
				maxAllowedTokens: 90,
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			maxContextWindow: 100,
			messages: [
				{
					role: "assistant",
					content: "checkpoint",
					usage: {
						input: { cached: 0, uncached: 89, total: 89 },
						output: 0,
					},
				},
				{
					role: "user",
					content: [{ type: "text", content: "hello" }],
				},
			],
		};

		await expect(bridge.compactionDecision(params)).resolves.toEqual({
			shouldCompact: true,
			estimatedTokens: 91,
			maxAllowedTokens: 90,
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_COMPACTION_DECISION_METHOD,
				params,
			},
		]);
	});

	it("requests agentd compaction prompt preparation", async () => {
		const processClient = new FakeProcessClient([
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", content: "work" }],
					},
					{
						role: "user",
						content: [{ type: "text", content: "Generate a summary" }],
					},
				],
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			messages: [
				{
					role: "user",
					content: [{ type: "text", content: "work" }],
				},
			],
		};

		await expect(bridge.compactionPrepare(params)).resolves.toEqual({
			messages: [
				{
					role: "user",
					content: [{ type: "text", content: "work" }],
				},
				{
					role: "user",
					content: [{ type: "text", content: "Generate a summary" }],
				},
			],
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_COMPACTION_PREPARE_METHOD,
				params,
			},
		]);
	});

	it("requests agentd compaction checkpoint content", async () => {
		const processClient = new FakeProcessClient([
			{
				status: "success",
				content: [
					{ type: "text", content: "# Conversation History Summary\n\n" },
					{ type: "text", content: "short summary" },
					{ type: "text", content: "\n\nResume your work now." },
				],
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			unexpectedToolCall: false,
			output: {
				role: "assistant",
				content: "short summary",
				usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
			},
		};

		await expect(bridge.compactionCheckpointContent(params)).resolves.toEqual({
			status: "success",
			content: [
				{ type: "text", content: "# Conversation History Summary\n\n" },
				{ type: "text", content: "short summary" },
				{ type: "text", content: "\n\nResume your work now." },
			],
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
				params,
			},
		]);
	});

	it("requests agentd JSON autofix", async () => {
		const processClient = new FakeProcessClient([
			{
				success: true,
				fixed: { valid: true },
				usage: { input: 11, output: 3 },
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			baseUrl: "https://api.example.test/v1",
			apiKey: "test-key",
			model: "gpt-test",
			brokenJson: '{"valid":',
		};

		await expect(bridge.autofixJson(params)).resolves.toEqual({
			success: true,
			fixed: { valid: true },
			usage: { input: 11, output: 3 },
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_AUTOFIX_JSON_METHOD,
				params,
			},
		]);
	});

	it("requests agentd edit autofix", async () => {
		const processClient = new FakeProcessClient([
			{
				success: true,
				search: "old text",
				usage: { input: 12, output: 4 },
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			baseUrl: "https://api.example.test/v1",
			apiKey: "test-key",
			model: "gpt-test",
			file: "old text",
			edit: {
				search: "old",
				replace: "new",
			},
		};

		await expect(bridge.autofixEdit(params)).resolves.toEqual({
			success: true,
			search: "old text",
			usage: { input: 12, output: 4 },
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_AUTOFIX_EDIT_METHOD,
				params,
			},
		]);
	});

	it("requests agentd Octo IR lowering", async () => {
		const processClient = new FakeProcessClient([
			{
				irs: [
					{
						role: "lowered-checkpoint",
						content: [{ type: "text", content: "summary" }],
					},
				],
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			messages: [
				{
					role: "checkpoint",
					content: [{ type: "text", content: "summary" }],
				},
			],
			modalities: {
				image: {
					enabled: true,
					maxSizeMB: 1,
					acceptedMimeTypes: ["image/png"],
				},
			},
		};

		await expect(bridge.octoLower(params)).resolves.toEqual({
			irs: [
				{
					role: "lowered-checkpoint",
					content: [{ type: "text", content: "summary" }],
				},
			],
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_OCTO_LOWER_METHOD,
				params,
			},
		]);
	});

	it("requests agentd model connection tests", async () => {
		const processClient = new FakeProcessClient([
			{
				valid: true,
				promptTokens: 3,
				completionTokens: 1,
				metadata: { name: "GPT Test", contextLength: 8192 },
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			baseUrl: "https://api.example.test/v1",
			apiKey: "test-key",
			model: "gpt-test",
		};

		await expect(bridge.modelConnectionTest(params)).resolves.toEqual({
			valid: true,
			promptTokens: 3,
			completionTokens: 1,
			metadata: { name: "GPT Test", contextLength: 8192 },
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_MODEL_CONNECTION_TEST_METHOD,
				params,
			},
		]);
	});

	it("requests agentd Synthetic quota fetches", async () => {
		const quota = {
			rollingFiveHourLimit: {
				remaining: 4,
				max: 10,
				nextTickAt: "2026-07-05T12:00:00Z",
				tickPercent: 0.5,
			},
			weeklyTokenLimit: null,
		};
		const processClient = new FakeProcessClient([{ quota }]);
		const bridge = new AgentdRustBridge(processClient);
		const params = { apiKey: "test-key" };

		await expect(bridge.syntheticQuotaFetch(params)).resolves.toEqual({
			quota,
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD,
				params,
			},
		]);
	});

	it("rejects malformed Synthetic quota bridge responses", async () => {
		const processClient = new FakeProcessClient([{ quota: "not-object" }]);
		const bridge = new AgentdRustBridge(processClient);

		await expect(
			bridge.syntheticQuotaFetch({ apiKey: "test-key" }),
		).rejects.toThrow("Invalid octofwen-agentd Synthetic quota fetch response");
	});

	it("requests agentd trajectory finish decisions", async () => {
		const response: AgentdTrajectoryFinishResult = {
			irs: [
				{
					role: "assistant",
					content: "answer",
					usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
				},
			],
			reason: { type: "needs-response" },
			events: [],
		};
		const processClient = new FakeProcessClient([response]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			irs: [],
			assistantMessage: {
				role: "assistant",
				content: "answer",
				usage: { input: { cached: 0, uncached: 0, total: 0 }, output: 0 },
			},
		} as const;

		await expect(bridge.trajectoryFinish(params)).resolves.toEqual(response);
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_TRAJECTORY_FINISH_METHOD,
				params,
			},
		]);
	});

	it("requests agentd tool definitions", async () => {
		const processClient = new FakeProcessClient([
			{
				tools: [
					{
						name: "read",
						description: "Read files",
						argumentsSchema: { type: "object" },
					},
				],
			},
		]);
		const bridge = new AgentdRustBridge(processClient);
		const params = { hasMcpServers: true, hasWebSearch: false, skills: [] };

		await expect(bridge.toolDefinitions(params)).resolves.toEqual({
			tools: [
				{
					name: "read",
					description: "Read files",
					argumentsSchema: { type: "object" },
				},
			],
		});
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_TOOL_DEFINITIONS_METHOD,
				params,
			},
		]);
	});

	it("passes tool validation results to trajectory finish for retry output shaping", async () => {
		const response: AgentdTrajectoryFinishResult = {
			irs: [
				{
					role: "tool-validation-error",
					toolCall: {
						type: "tool-call",
						name: "read",
						toolCallId: "call_invalid",
						original: { filePath: "missing.md" },
						parsed: { filePath: "missing.md" },
					},
					error: "invalid read",
					aborted: false,
				},
			],
			reason: { type: "needs-response" },
			events: [],
		};
		const processClient = new FakeProcessClient([response]);
		const bridge = new AgentdRustBridge(processClient);
		const params = {
			irs: [],
			toolCalls: [
				{
					type: "tool-call",
					name: "read",
					toolCallId: "call_invalid",
					original: { filePath: "missing.md" },
					parsed: { filePath: "missing.md" },
				},
			],
			validationResults: [
				{ status: "error", message: "invalid read", aborted: false },
			],
		} as const;

		await expect(bridge.trajectoryFinish(params)).resolves.toEqual(response);
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_TRAJECTORY_FINISH_METHOD,
				params,
			},
		]);
	});

	it("closes the underlying process client", () => {
		const processClient = new FakeProcessClient([]);
		const bridge = new AgentdRustBridge(processClient);

		bridge.close();

		expect(processClient.closed).toBe(true);
	});

	it("spawns the configured agentd executable as a stdio process client", () => {
		const calls: unknown[][] = [];
		const client = spawnAgentdProcessClient({
			executable: "/tmp/octofwen-agentd",
			spawn(command, options) {
				calls.push([command, options]);
				return inertProcess();
			},
		});

		client.close();
		expect(calls).toEqual([
			[
				["/tmp/octofwen-agentd"],
				{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
			],
		]);
	});

	it("creates an initialized bridge using the process factory", async () => {
		const processClient = new FakeProcessClient([
			{
				serverInfo: { name: "octofwen-agentd", version: "0.0.0" },
				capabilities: { renderModels: true },
			},
		]);

		const bridge = await createAgentdRustBridge({
			createClient: () => processClient,
		});

		expect(bridge).toBeInstanceOf(AgentdRustBridge);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_INITIALIZE_METHOD },
		]);
		bridge.close();
	});
});

describe("AgentdRustBridge response validation", () => {
	it("rejects malformed initialize responses", async () => {
		const bridge = new AgentdRustBridge(
			new FakeProcessClient([{ serverInfo: null }]),
		);

		await expect(bridge.initialize()).rejects.toThrow(
			"Invalid octofwen-agentd initialize response",
		);
	});

	it("rejects malformed tool definition responses", async () => {
		const bridge = new AgentdRustBridge(
			new FakeProcessClient([{ tools: null }]),
		);

		await expect(
			bridge.toolDefinitions({
				hasMcpServers: false,
				hasWebSearch: false,
				skills: [],
			}),
		).rejects.toThrow("Invalid octofwen-agentd tool definitions response");
	});

	it("rejects malformed tool render models", async () => {
		const bridge = new AgentdRustBridge(
			new FakeProcessClient([{ kind: "shell", title: "shell" }]),
		);

		await expect(
			bridge.renderToolCall("shell", { cmd: "pwd" }),
		).rejects.toThrow("Invalid octofwen-agentd tool render response");
	});
});
