import { describe, expect, it } from "bun:test";
import {
	AGENTD_CONVERSATION_HISTORY_APPEND_METHOD,
	AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
	AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD,
	type AgentdConversationHistoryAppendParams,
	type AgentdConversationHistoryParams,
	AgentdRustBridge,
} from "../../../bridge/rust/agent.ts";

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
