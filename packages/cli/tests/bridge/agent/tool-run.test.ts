import { describe, expect, it } from "bun:test";
import {
	AGENTD_TOOL_RUN_METHOD,
	AgentdRustBridge,
	type AgentdToolRunParams,
	type AgentdToolRunResult,
} from "../../../src/bridge/agent/agent";

type RecordedRequest = { method: string; params?: unknown; options?: unknown };

class FakeProcessClient {
	readonly responses: unknown[];
	closed = false;
	readonly requests: RecordedRequest[] = [];
	constructor(responses: unknown[]) {
		this.responses = responses;
	}
	request(
		method: string,
		params?: unknown,
		options?: unknown,
	): Promise<unknown> {
		this.requests.push({ method, params, options });
		return Promise.resolve(this.responses.shift());
	}
	close(): void {
		this.closed = true;
	}
}

describe("AgentdRustBridge tool run", () => {
	it("requests agentd tool run", async () => {
		const result: AgentdToolRunResult = {
			status: "completed",
			result: {
				type: "output",
				content: [{ type: "text", content: "output" }],
			},
		};
		const client = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(client);
		const params: AgentdToolRunParams = {
			toolName: "list",
			cwd: "/repo",
			toolCallId: "list-1",
			toolCall: {
				type: "tool-call",
				toolCallId: "list-1",
				name: "list",
				original: { dirPath: "." },
				parsed: { dirPath: "." },
			},
			parsed: { dirPath: "." },
		};

		const abortSignal = new AbortController().signal;

		await expect(
			bridge.toolRun(params, { abortSignal, cancelOnAbort: true }),
		).resolves.toEqual(result);
		expect(client.requests).toEqual([
			{
				method: AGENTD_TOOL_RUN_METHOD,
				params,
				options: { abortSignal, cancelOnAbort: true },
			},
		]);
	});
});
