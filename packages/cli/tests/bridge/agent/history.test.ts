import { describe, expect, it } from "bun:test";
import {
	AGENTD_CONVERSATION_HISTORY_APPEND_METHOD,
	AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
	AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD,
	AGENTD_CONVERSATION_SESSION_CREATE_METHOD,
	AGENTD_CONVERSATION_SESSION_LOAD_METHOD,
	AGENTD_CONVERSATION_SESSION_REPLACE_METHOD,
	type AgentdConversationHistoryAppendParams,
	type AgentdConversationHistoryParams,
	type AgentdConversationSessionCreateParams,
	type AgentdConversationSessionReplaceParams,
	AgentdRustBridge,
} from "../../../src/bridge/agent/agent";

type RecordedRequest = {
	method: string;
	params?: unknown;
};

class FakeProcessClient {
	readonly requests: RecordedRequest[] = [];
	private readonly responses: unknown[];

	constructor(responses: unknown[]) {
		this.responses = responses;
	}
	request(method: string, params?: unknown): Promise<unknown> {
		this.requests.push({ method, params });
		return Promise.resolve(this.responses.shift());
	}
	close(): void {
		return;
	}
}

describe("AgentdRustBridge conversation history", () => {
	it("creates, replaces, and loads conversation sessions", async () => {
		const createResult = {};
		const replaceResult = { revisionId: 8 };
		const loadResult = {
			metadata: {
				sessionId: "session-123",
				cwd: "/workspace/project",
				launchJson: '{"kind":"local"}',
				createdAt: 100,
				updatedAt: 200,
			},
			revisionId: 7,
			records: [{ id: 1, kind: "notification" as const, payload: "hello" }],
		};
		const processClient = new FakeProcessClient([
			createResult,
			replaceResult,
			loadResult,
		]);
		const bridge = new AgentdRustBridge(processClient);
		const createParams: AgentdConversationSessionCreateParams = {
			databasePath: "/tmp/session.sqlite",
			sessionId: "session-123",
			cwd: "/workspace/project",
			launchJson: '{"kind":"local"}',
			timestamp: 100,
		};
		const replaceParams: AgentdConversationSessionReplaceParams = {
			databasePath: "/tmp/session.sqlite",
			records: [{ kind: "notification", payload: "hello" }],
			parentRevisionId: 7,
			timestamp: 200,
		};
		const loadParams = { databasePath: "/tmp/session.sqlite" };

		await expect(
			bridge.conversationSessionCreate(createParams),
		).resolves.toEqual(createResult);
		await expect(
			bridge.conversationSessionReplace(replaceParams),
		).resolves.toEqual(replaceResult);
		await expect(bridge.conversationSessionLoad(loadParams)).resolves.toEqual(
			loadResult,
		);
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_CONVERSATION_SESSION_CREATE_METHOD,
				params: createParams,
			},
			{
				method: AGENTD_CONVERSATION_SESSION_REPLACE_METHOD,
				params: replaceParams,
			},
			{ method: AGENTD_CONVERSATION_SESSION_LOAD_METHOD, params: loadParams },
		]);
	});

	it("appends conversation history through agentd storage", async () => {
		const result = {};
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdConversationHistoryAppendParams = {
			databasePath: "/tmp/conversation.sqlite",
			entry: { kind: "llm-ir", payload: '{"role":"user"}' },
		};

		await expect(bridge.conversationHistoryAppend(params)).resolves.toEqual(
			result,
		);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_CONVERSATION_HISTORY_APPEND_METHOD, params },
		]);
	});

	it("reads conversation history records through agentd storage", async () => {
		const result = {
			records: [{ id: 1, kind: "notification" as const, payload: "heads up" }],
		};
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdConversationHistoryParams = {
			databasePath: "/tmp/conversation.sqlite",
		};

		await expect(bridge.conversationHistoryRecords(params)).resolves.toEqual(
			result,
		);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD, params },
		]);
	});

	it("reads conversation LLM payloads through agentd storage", async () => {
		const result = { payloads: ['{"role":"user"}'] };
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdConversationHistoryParams = {
			databasePath: "/tmp/conversation.sqlite",
		};

		await expect(
			bridge.conversationHistoryLlmPayloads(params),
		).resolves.toEqual(result);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD, params },
		]);
	});
});
