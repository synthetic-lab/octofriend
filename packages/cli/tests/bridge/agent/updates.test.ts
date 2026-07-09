import { describe, expect, it } from "bun:test";
import {
	AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD,
	AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
	AgentdRustBridge,
	type AgentdUpdateNotificationsParams,
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

describe("AgentdRustBridge update notifications", () => {
	it("reads update notifications through agentd storage", async () => {
		const result = { updates: "New update\n" };
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdUpdateNotificationsParams = {
			updatesPath: "/tmp/IN-APP-UPDATES.txt",
			databasePath: "/tmp/sqlite.db",
		};

		await expect(bridge.updateNotificationsRead(params)).resolves.toEqual(
			result,
		);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD, params },
		]);
	});

	it("marks update notifications through agentd storage", async () => {
		const result = {};
		const processClient = new FakeProcessClient([result]);
		const bridge = new AgentdRustBridge(processClient);
		const params: AgentdUpdateNotificationsParams = {
			updatesPath: "/tmp/IN-APP-UPDATES.txt",
			databasePath: "/tmp/sqlite.db",
		};

		await expect(bridge.updateNotificationsMarkSeen(params)).resolves.toEqual(
			result,
		);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD, params },
		]);
	});
});
