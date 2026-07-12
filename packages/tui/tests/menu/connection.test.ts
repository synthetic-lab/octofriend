import { describe, expect, it } from "bun:test";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("terminal model setup connection helpers", () => {
	it("returns provider error text from failed connection tests", async () => {
		const { testConnection } = await import(
			"../../src/menu/models/connection.ts"
		);

		const result = await testConnection({
			baseUrl: "https://api.example.test/v1",
			model: "example-model",
			config: null,
			auth: { type: "env", name: "MODEL_SETUP_TEST_KEY" },
			env: { MODEL_SETUP_TEST_KEY: "test-key" },
			modelConnectionTest: async () =>
				Promise.reject(new Error("invalid key or billing required")),
		});

		expect(result).toEqual({
			valid: false,
			errorMessage: "invalid key or billing required",
		});
	});

	it("rejects malformed explicit env auth before provider default fallback", async () => {
		const { testConnection } = await import(
			"../../src/menu/models/connection.ts"
		);
		const requests: unknown[] = [];

		const result = await testConnection({
			baseUrl: "https://api.openai.com/v1",
			model: "gpt-5.4-mini",
			config: {
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: { openai: "PATH" },
			},
			auth: {
				type: "env",
			} as unknown as import("../../src/runtime/config/schemas").Auth,
			env: { PATH: "fallback-key" },
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(result).toEqual({
			valid: false,
			errorMessage: "Environment auth name is missing.",
		});
		expect(requests).toEqual([]);
	});

	it("passes native provider types to connection tests for known provider base URLs", async () => {
		const { testConnection } = await import(
			"../../src/menu/models/connection.ts"
		);
		const requests: unknown[] = [];

		const env = { MODEL_SETUP_PROVIDER_TYPE_TEST_KEY: "test-key" };
		const openai = await testConnection({
			baseUrl: "https://api.openai.com/v1",
			model: "gpt-5.4-mini",
			config: null,
			auth: { type: "env", name: "MODEL_SETUP_PROVIDER_TYPE_TEST_KEY" },
			env,
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});
		const anthropic = await testConnection({
			baseUrl: "https://api.anthropic.com",
			model: "claude-haiku-4-5",
			config: null,
			auth: { type: "env", name: "MODEL_SETUP_PROVIDER_TYPE_TEST_KEY" },
			env,
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});
		const gemini = await testConnection({
			baseUrl: "https://generativelanguage.googleapis.com/v1beta",
			model: "gemini-3.5-flash",
			config: null,
			auth: { type: "env", name: "MODEL_SETUP_PROVIDER_TYPE_TEST_KEY" },
			env,
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(openai).toEqual({ valid: true, metadata: {} });
		expect(anthropic).toEqual({ valid: true, metadata: {} });
		expect(gemini).toEqual({ valid: true, metadata: {} });
		expect(requests).toEqual([
			{
				type: "openai-responses",
				baseUrl: "https://api.openai.com/v1",
				apiKey: "test-key",
				model: "gpt-5.4-mini",
			},
			{
				type: "anthropic",
				baseUrl: "https://api.anthropic.com",
				apiKey: "test-key",
				model: "claude-haiku-4-5",
			},
			{
				type: "gemini",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				apiKey: "test-key",
				model: "gemini-3.5-flash",
			},
		]);
	});

	it("uses selected provider type for connection tests when the base URL is overridden", async () => {
		const { testConnection } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const requests: unknown[] = [];

		const result = await testConnection({
			baseUrl: "http://127.0.0.1:8080/v1",
			provider: {
				...expectPresent(PROVIDERS.openai),
				baseUrl: "http://127.0.0.1:8080/v1",
			},
			model: "gpt-5.4-mini",
			config: null,
			auth: { type: "env", name: "MODEL_SETUP_PROVIDER_OVERRIDE_TEST_KEY" },
			env: { MODEL_SETUP_PROVIDER_OVERRIDE_TEST_KEY: "test-key" },
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(result).toEqual({ valid: true, metadata: {} });
		expect(requests).toEqual([
			{
				type: "openai-responses",
				baseUrl: "http://127.0.0.1:8080/v1",
				apiKey: "test-key",
				model: "gpt-5.4-mini",
			},
		]);
	});

	it("uses the selected provider type to resolve default auth for custom base URLs", async () => {
		const { testConnection } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const pathKey = process.env.PATH;
		if (!pathKey) throw new Error("PATH must be set for this test");
		const requests: unknown[] = [];

		const result = await testConnection({
			baseUrl: "http://127.0.0.1:9999/custom-anthropic",
			provider: {
				...expectPresent(PROVIDERS.anthropic),
				baseUrl: "http://127.0.0.1:9999/custom-anthropic",
			},
			model: "claude-haiku-4-5",
			config: {
				yourName: "",
				models: [],
				defaultApiKeyOverrides: { anthropic: "PATH" },
			},
			auth: undefined,
			env: {},
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(result).toEqual({ valid: true, metadata: {} });
		expect(requests).toEqual([
			{
				type: "anthropic",
				baseUrl: "http://127.0.0.1:9999/custom-anthropic",
				apiKey: pathKey,
				model: "claude-haiku-4-5",
			},
		]);
	});

	it("allows ChatGPT OAuth only for OpenAI provider connection tests", async () => {
		const { testConnection } = await import(
			"../../src/menu/models/connection.ts"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main.ts"
		);
		const env = { CODEX_ACCESS_TOKEN: "oauth-token" };
		const requests: unknown[] = [];

		const openai = await testConnection({
			baseUrl: "https://api.openai.com/v1",
			provider: expectPresent(PROVIDERS.openai),
			model: "gpt-5.4-mini",
			config: null,
			auth: {
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
			env,
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});
		const anthropic = await testConnection({
			baseUrl: "https://api.anthropic.com",
			provider: expectPresent(PROVIDERS.anthropic),
			model: "claude-haiku-4-5",
			config: null,
			auth: {
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
			env,
			modelConnectionTest: (params) => {
				requests.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(openai).toEqual({ valid: true, metadata: {} });
		expect(anthropic).toEqual({
			valid: false,
			errorMessage: "ChatGPT OAuth is only supported for OpenAI providers.",
		});
		expect(requests).toEqual([
			{
				type: "openai-responses",
				baseUrl: "https://chatgpt.com/backend-api/codex",
				apiKey: "codex-oauth:oauth-token",
				model: "gpt-5.4-mini",
			},
		]);
	});
});
