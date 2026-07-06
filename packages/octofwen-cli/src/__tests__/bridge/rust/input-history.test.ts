import { describe, expect, it } from "bun:test";
import {
	AGENTD_INPUT_HISTORY_APPEND_METHOD,
	AGENTD_INPUT_HISTORY_LOAD_METHOD,
	type AgentdInputHistoryAppendParams,
	type AgentdInputHistoryLoadParams,
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

describe("AgentdRustBridge input history", () => {
	it("loads input history through agentd storage", async () => {
		const result = { history: ["one", "two"] };
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdInputHistoryLoadParams = {
			databasePath: "/tmp/input.sqlite",
			maxHistoryItems: 2,
		};

		await expect(bridge.inputHistoryLoad(params)).resolves.toEqual(result);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_INPUT_HISTORY_LOAD_METHOD, params },
		]);
	});

	it("appends input history through agentd storage", async () => {
		const result = { history: ["two", "three"] };
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdInputHistoryAppendParams = {
			databasePath: "/tmp/input.sqlite",
			maxHistoryItems: 2,
			input: "three",
		};

		await expect(bridge.inputHistoryAppend(params)).resolves.toEqual(result);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_INPUT_HISTORY_APPEND_METHOD, params },
		]);
	});
});
