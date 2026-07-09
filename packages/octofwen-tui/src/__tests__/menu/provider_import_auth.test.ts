import { describe, expect, it } from "bun:test";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("provider import auth metadata", () => {
	it("preserves OpenAI ChatGPT OAuth auth on imported recommended models", async () => {
		const { buildImportedProviderModels, providerModelAuth } = await import(
			"../../menu/model_setup/provider-import-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const oauthAuth = {
			type: "env" as const,
			name: "CODEX_ACCESS_TOKEN",
			credential: "chatgpt-oauth" as const,
		};

		expect(
			providerModelAuth({
				provider: openai,
				config: null,
				overrideAuth: oauthAuth,
				useEnvVar: false,
			}),
		).toEqual(oauthAuth);
		expect(
			buildImportedProviderModels({
				models: [
					{ model: "gpt-custom", nickname: "GPT Custom", context: 400000 },
				],
				provider: openai,
				config: null,
				overrideAuth: oauthAuth,
				useEnvVar: false,
			}),
		).toEqual([
			{
				model: "gpt-custom",
				nickname: "GPT Custom (OpenAI)",
				context: 400000,
				baseUrl: openai.baseUrl,
				type: "openai-responses",
				auth: oauthAuth,
			},
		]);
	});

	it("summarizes imported provider model authentication paths", async () => {
		const { providerImportAuthText } = await import(
			"../../menu/model_setup/provider-import-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const anthropic = expectPresent(PROVIDERS.anthropic);

		expect(
			providerImportAuthText({
				provider: openai,
				config: null,
				overrideAuth: {
					type: "env",
					name: " CODEX_ACCESS_TOKEN\n",
					credential: "chatgpt-oauth",
				},
				useEnvVar: false,
			}),
		).toBe("Authentication: ChatGPT OAuth via CODEX_ACCESS_TOKEN");
		expect(
			providerImportAuthText({
				provider: anthropic,
				config: {
					yourName: "Ada",
					models: [],
					defaultApiKeyOverrides: { anthropic: "ANTHROPIC_FROM_CONFIG" },
				},
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toBe("Authentication: API key via ANTHROPIC_FROM_CONFIG");
		expect(
			providerImportAuthText({
				provider: anthropic,
				config: null,
				overrideAuth: {
					type: "env",
					name: "CODEX_ACCESS_TOKEN",
					credential: "chatgpt-oauth",
				},
				useEnvVar: false,
			}),
		).toBe("Authentication: not supported for this provider");
	});

	it("preserves active provider base URL overrides on imported models", async () => {
		const { buildImportedProviderModels } = await import(
			"../../menu/model_setup/provider-import-auth.ts"
		);
		const { providerWithResolvedBaseUrl, PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const proxiedOpenai = providerWithResolvedBaseUrl("openai", openai, {
			OPENAI_BASE_URL: " http://127.0.0.1:8080/v1 ",
		});

		expect(
			buildImportedProviderModels({
				models: [
					{ model: "gpt-custom", nickname: "GPT Custom", context: 400000 },
				],
				provider: proxiedOpenai,
				config: null,
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toEqual([
			{
				model: "gpt-custom",
				nickname: "GPT Custom (OpenAI)",
				context: 400000,
				baseUrl: "http://127.0.0.1:8080/v1",
				type: "openai-responses",
			},
		]);
	});

	it("preserves provider auth metadata on custom provider models", async () => {
		const { buildCustomProviderModel } = await import(
			"../../menu/model_setup/provider-import.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const anthropic = expectPresent(PROVIDERS.anthropic);
		const apiKeyAuth = {
			type: "env" as const,
			name: "ANTHROPIC_API_KEY",
			credential: "api-key" as const,
		};
		const customModel = {
			baseUrl: anthropic.baseUrl,
			auth: apiKeyAuth,
			model: "claude-custom",
			nickname: "Claude Custom",
			context: 200000,
		};

		expect(buildCustomProviderModel(customModel, anthropic)).toEqual({
			...customModel,
			type: "anthropic",
		});
	});

	it("does not invent API-key auth for providers without API-key support", async () => {
		const { providerModelAuth } = await import(
			"../../menu/model_setup/provider-import-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openai = expectPresent(PROVIDERS.openai);

		expect(
			providerModelAuth({
				provider: { ...openai, authMethods: ["chatgpt-oauth"] },
				config: null,
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toBeUndefined();

		expect(
			providerModelAuth({
				provider: { ...openai, authMethods: [] },
				config: null,
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toBeUndefined();
	});

	it("omits provider API-key env auth on imported models so provider overrides stay canonical", async () => {
		const { buildImportedProviderModels, providerModelAuth } = await import(
			"../../menu/model_setup/provider-import-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const anthropic = expectPresent(PROVIDERS.anthropic);
		const apiKeyAuth = {
			type: "env" as const,
			name: " ANTHROPIC_PROXY_KEY ",
			credential: "api-key" as const,
		};

		expect(
			providerModelAuth({
				provider: anthropic,
				config: {
					yourName: "Ada",
					models: [],
					defaultApiKeyOverrides: { anthropic: "ANTHROPIC_PROXY_KEY" },
				},
				overrideAuth: apiKeyAuth,
				useEnvVar: false,
			}),
		).toBeUndefined();
		expect(
			providerModelAuth({
				provider: anthropic,
				config: null,
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toBeUndefined();
		expect(
			buildImportedProviderModels({
				models: [
					{
						model: "claude-custom",
						nickname: "Claude Custom",
						context: 200000,
					},
				],
				provider: anthropic,
				config: null,
				overrideAuth: apiKeyAuth,
				useEnvVar: false,
			}),
		).toEqual([
			{
				model: "claude-custom",
				nickname: "Claude Custom (Anthropic)",
				context: 200000,
				baseUrl: anthropic.baseUrl,
				type: "anthropic",
			},
		]);
	});

	it("does not preserve ChatGPT OAuth override auth for API-key-only providers", async () => {
		const { buildImportedProviderModels, providerModelAuth } = await import(
			"../../menu/model_setup/provider-import-auth.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const anthropic = expectPresent(PROVIDERS.anthropic);
		const oauthAuth = {
			type: "env" as const,
			name: "CODEX_ACCESS_TOKEN",
			credential: "chatgpt-oauth" as const,
		};

		expect(
			providerModelAuth({
				provider: anthropic,
				config: null,
				overrideAuth: oauthAuth,
				useEnvVar: false,
			}),
		).toBeUndefined();
		expect(
			buildImportedProviderModels({
				models: [
					{
						model: "claude-custom",
						nickname: "Claude Custom",
						context: 200000,
					},
				],
				provider: anthropic,
				config: null,
				overrideAuth: oauthAuth,
				useEnvVar: false,
			}),
		).toEqual([
			{
				model: "claude-custom",
				nickname: "Claude Custom (Anthropic)",
				context: 200000,
				baseUrl: anthropic.baseUrl,
				type: "anthropic",
			},
		]);
	});
	it("filters canonical Synthetic imports when a local proxy base URL is active", async () => {
		const { providerWithResolvedBaseUrl } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const { getRemainingProviderModels } = await import(
			"../../menu/model_setup/provider-import.ts"
		);
		const synthetic = expectPresent(PROVIDERS.synthetic);
		const proxiedSynthetic = providerWithResolvedBaseUrl(
			"synthetic",
			synthetic,
			{ SYNTHETIC_BASE_URL: "http://127.0.0.1:8080/v1" },
		);
		const importedModel = expectPresent(synthetic.models[0]);

		expect(proxiedSynthetic.baseUrlAliases).toContain(synthetic.baseUrl);
		expect(
			getRemainingProviderModels(
				{
					yourName: "Ada",
					models: [
						{
							...importedModel,
							nickname: `${importedModel.nickname} (Synthetic)`,
							baseUrl: synthetic.baseUrl,
						},
					],
				},
				proxiedSynthetic,
			).map((model) => model.model),
		).not.toContain(importedModel.model);
	});
});
