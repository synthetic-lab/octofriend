import { describe, expect, it } from "bun:test";
import {
	AGENTD_TOOL_VALIDATE_METHOD,
	AgentdRustBridge,
	type AgentdToolValidateParams,
	type AgentdToolValidateResult,
} from "../../../bridge/rust/agent.ts";

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

describe("AgentdRustBridge tool validation", () => {
	it("requests agentd tool validation", async () => {
		const result: AgentdToolValidateResult = { status: "valid" };
		const client = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(client);
		const params: AgentdToolValidateParams = {
			toolName: "edit",
			cwd: "/repo",
			parsed: { filePath: "edit.txt", search: "old", replace: "new" },
		};

		const abortSignal = new AbortController().signal;

		await expect(
			bridge.toolValidate(params, { abortSignal, cancelOnAbort: true }),
		).resolves.toEqual(result);
		expect(client.requests).toEqual([
			{
				method: AGENTD_TOOL_VALIDATE_METHOD,
				params,
				options: { abortSignal, cancelOnAbort: true },
			},
		]);
	});
});
