import { describe, expect, it } from "bun:test";
import {
	AGENTD_CONFIG_MIGRATE_METHOD,
	AGENTD_CONFIG_SANITIZE_METHOD,
	AGENTD_MODEL_PROVIDER_CATALOG_METHOD,
	type AgentdModelProviderCatalogResult,
	AgentdRustBridge,
} from "../../../src/bridge/agent/agent";
import { AgentdBridgeResponseError } from "../../../src/bridge/agent/errors";

class FakeProcessClient {
	readonly responses: unknown[];
	readonly requests: Array<{ method: string; params?: unknown }> = [];
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

const catalogResponse: AgentdModelProviderCatalogResult = {
	defaultMultimodalImageModelExample: "Kimi K2.5",
	syntheticProviderKey: "synthetic",
	providers: {
		synthetic: {
			shortcut: "s",
			type: "standard",
			name: "Synthetic",
			envVar: "SYNTHETIC_API_KEY",
			baseUrl: "https://api.synthetic.new/v1",
			baseUrlAliases: [
				"https://api.synthetic.new/openai/v1",
				"https://synthetic.new/api/openai/v1",
				"https://api.glhf.chat/v1",
				"https://glhf.chat/api/v1",
				"https://glhf.chat/api/openai/v1",
			],
			apiKeyUrl: "https://dev.synthetic.new/",
			authMethods: ["api-key"],
			models: [
				{
					model: "hf:moonshotai/Kimi-K2.5",
					nickname: "Kimi K2.5",
					context: 262144,
					modalities: {
						image: {
							enabled: true,
							maxSizeMB: 10,
							acceptedMimeTypes: [
								"image/jpeg",
								"image/png",
								"image/webp",
								"image/gif",
							],
						},
					},
				},
			],
			testModel: "hf:MiniMaxAI/MiniMax-M2.1",
		},
		gemini: {
			shortcut: "g",
			type: "gemini",
			name: "Google Gemini",
			envVar: "GEMINI_API_KEY",
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			baseUrlAliases: [],
			apiKeyUrl: "https://aistudio.google.com/apikey",
			authMethods: ["api-key"],
			models: [
				{
					model: "gemini-3.5-flash",
					nickname: "Gemini 3.5 Flash",
					context: 1048576,
				},
			],
			testModel: "gemini-3.5-flash",
		},
	},
};

const CURRENT_CONFIG_VERSION = 6;

describe("AgentdRustBridge model provider catalog", () => {
	it("requests the agentd model provider catalog", async () => {
		const processClient = new FakeProcessClient([catalogResponse]);
		const bridge = new AgentdRustBridge(processClient);

		await expect(bridge.modelProviderCatalog()).resolves.toEqual(
			catalogResponse,
		);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_MODEL_PROVIDER_CATALOG_METHOD },
		]);
	});

	it("rejects malformed model provider catalog responses", async () => {
		const processClient = new FakeProcessClient([{ providers: [] }]);
		const bridge = new AgentdRustBridge(processClient);

		await expect(bridge.modelProviderCatalog()).rejects.toBeInstanceOf(
			AgentdBridgeResponseError,
		);
	});
});

describe("AgentdRustBridge config ownership", () => {
	it("requests agentd config migration and sanitization", async () => {
		const migrated = {
			config: {
				configVersion: CURRENT_CONFIG_VERSION,
				yourName: "Ada",
				models: [],
			},
		};
		const sanitized = {
			config: {
				configVersion: CURRENT_CONFIG_VERSION,
				yourName: "Ada",
				models: [{ baseUrl: "https://api.openai.com/v1" }],
			},
		};
		const processClient = new FakeProcessClient([migrated, sanitized]);
		const bridge = new AgentdRustBridge(processClient);
		const config = { yourName: "Ada", models: [] };

		await expect(bridge.configMigrate({ config })).resolves.toEqual(migrated);
		await expect(bridge.configSanitize({ config })).resolves.toEqual(sanitized);
		expect(processClient.requests).toEqual([
			{ method: AGENTD_CONFIG_MIGRATE_METHOD, params: { config } },
			{ method: AGENTD_CONFIG_SANITIZE_METHOD, params: { config } },
		]);
	});
});
