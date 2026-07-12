import { describe, expect, it } from "bun:test";
import {
	AGENTD_TOOL_PERMISSION_METHOD,
	AgentdRustBridge,
	type AgentdToolPermissionParams,
	type AgentdToolPermissionResult,
} from "../../../src/bridge/agent/agent.ts";

type RecordedRequest = { method: string; params?: unknown };

class FakeProcessClient {
	readonly responses: unknown[];
	closed = false;
	readonly requests: RecordedRequest[] = [];
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

describe("AgentdRustBridge tool permission", () => {
	it("requests agentd tool permission policy", async () => {
		const result: AgentdToolPermissionResult = {
			whitelistKey: "mcp:filesystem:read_file",
			skipConfirmation: false,
			alwaysRequestPermission: false,
		};
		const client = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(client);
		const params: AgentdToolPermissionParams = {
			toolName: "mcp",
			cwd: "/workspace/project",
			parsed: { server: "filesystem", tool: "read_file" },
		};

		await expect(bridge.toolPermission(params)).resolves.toEqual(result);
		expect(client.requests).toEqual([
			{ method: AGENTD_TOOL_PERMISSION_METHOD, params },
		]);
	});
});
