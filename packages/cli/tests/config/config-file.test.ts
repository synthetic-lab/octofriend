import { describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	AGENTD_CONFIG_MIGRATE_METHOD,
	AGENTD_CONFIG_SANITIZE_METHOD,
	AgentdRustBridge,
} from "../../src/bridge/agent/agent.ts";
import { readConfig } from "../../src/config/config-file.ts";
import type { Config } from "../../src/config/schemas.ts";

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

describe("config file bridge reuse", () => {
	it("uses a supplied bridge for migration writeback", async () => {
		const tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "octofriend-config-"),
		);
		const configPath = path.join(tmpDir, "config.json5");
		const originalConfig: Config = {
			configVersion: 5,
			yourName: "Ada",
			models: [],
			fixJson: {
				type: "gemini",
				baseUrl: "http://127.0.0.1:8080/v1beta",
				auth: {
					type: "env",
					name: "GEMINI_API_KEY",
					credential: "api-key",
				},
				model: "gemini-3.5-flash",
			},
		};
		const migratedConfig: Config = {
			configVersion: 6,
			yourName: "Ada",
			models: [],
			fixJson: originalConfig.fixJson,
		};
		await fs.writeFile(configPath, JSON.stringify(originalConfig));
		const processClient = new FakeProcessClient([
			{ config: migratedConfig },
			{ config: migratedConfig },
		]);
		const bridge = new AgentdRustBridge(processClient);

		const config = await readConfig(configPath, { bridge });

		expect(config).toEqual(migratedConfig);
		expect(processClient.closed).toBe(false);
		expect(processClient.requests).toEqual([
			{
				method: AGENTD_CONFIG_MIGRATE_METHOD,
				params: { config: originalConfig },
			},
			{
				method: AGENTD_CONFIG_SANITIZE_METHOD,
				params: { config: migratedConfig },
			},
		]);
	});
});
