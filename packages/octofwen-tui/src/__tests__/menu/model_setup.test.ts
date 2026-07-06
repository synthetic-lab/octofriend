import { describe, expect, it } from "bun:test";

describe("terminal model setup helpers", () => {
	it("uses a known provider name for matching base URLs", async () => {
		const { getProviderDisplayName } = await import(
			"../../menu/model_setup/primitives.tsx"
		);

		expect(getProviderDisplayName("https://api.openai.com/v1")).toBe("OpenAI");
	});

	it("falls back to the base URL for unknown providers", async () => {
		const { getProviderDisplayName } = await import(
			"../../menu/model_setup/primitives.tsx"
		);

		expect(getProviderDisplayName("https://models.example.test/v1")).toBe(
			"https://models.example.test/v1",
		);
	});

	it("rejects empty API keys with the legacy validation message", async () => {
		const { validateApiKeyValue } = await import(
			"../../menu/model_setup/primitives.tsx"
		);

		expect(validateApiKeyValue("")).toEqual({
			valid: false,
			error: "API key can't be empty",
		});
		expect(validateApiKeyValue("sk-test")).toEqual({ valid: true });
	});
});

describe("terminal model setup routing", () => {
	it("returns typed route builders unchanged", async () => {
		const { router } = await import("../../menu/model_setup/primitives.tsx");
		type Routes = {
			first: { value: string };
			second: { count: number };
		};
		const routes = router<Routes>();
		const first = routes.build("first", () => () => null);
		const second = routes
			.withRoutes("second")
			.build("second", () => () => null);

		expect(typeof first).toBe("function");
		expect(typeof second).toBe("function");
	});
});

describe("model setup state helpers", () => {
	it("resolves provider env vars from explicit override, config override, then provider default", async () => {
		const { resolveProviderEnvVar } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { keyFromName, PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const openaiKey = keyFromName(PROVIDERS.openai.name);
		const config = {
			defaultApiKeyOverrides: {
				[openaiKey]: "OPENAI_FROM_CONFIG",
			},
		};

		expect(
			resolveProviderEnvVar(PROVIDERS.openai, config, "OPENAI_EXPLICIT"),
		).toBe("OPENAI_EXPLICIT");
		expect(resolveProviderEnvVar(PROVIDERS.openai, config, null)).toBe(
			"OPENAI_FROM_CONFIG",
		);
		expect(resolveProviderEnvVar(PROVIDERS.openai, null, null)).toBe(
			PROVIDERS.openai.envVar,
		);
	});

	it("keeps stale step transitions from replacing the current setup state", async () => {
		const { reduceModelSetupStep } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(
			reduceModelSetupStep(
				{ step: "missing", provider: { ...PROVIDERS.openai } },
				{ from: "found", to: { step: "initial" } },
			),
		).toEqual({ step: "missing", provider: { ...PROVIDERS.openai } });
		expect(
			reduceModelSetupStep(
				{ step: "missing", provider: { ...PROVIDERS.openai } },
				{ force: true, to: { step: "initial" } },
			),
		).toEqual({ step: "initial" });
	});
});

describe("autofix model setup helpers", () => {
	it("resolves Synthetic autofix from configured env var overrides", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = keyFromName(SYNTHETIC_PROVIDER.name);

		const result = await resolveSyntheticAutofixSelection({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			defaultModel: "synthetic-diff",
			env: { SYNTHETIC_OVERRIDE: "present" },
			readKeyForModel: () => {
				throw new Error("key file should not be read when env auth exists");
			},
		});

		expect(result).toEqual({
			step: "complete",
			diffApply: {
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiEnvVar: "SYNTHETIC_OVERRIDE",
				model: "synthetic-diff",
			},
		});
	});

	it("uses a stored Synthetic key before asking for missing auth", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: {},
			readKeyForModel: (model) => {
				expect(model).toEqual({ baseUrl: SYNTHETIC_PROVIDER.baseUrl });
				return Promise.resolve("stored-key");
			},
		});

		expect(result).toEqual({
			step: "complete",
			diffApply: {
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				model: "synthetic-diff",
			},
		});
	});

	it("returns missing auth when Synthetic env and stored key are absent", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/primitives.tsx"
		);

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: {},
			readKeyForModel: async () => null,
		});

		expect(result).toEqual({ step: "missing-auth" });
	});

	it("builds Synthetic autofix config from custom auth results", async () => {
		const { syntheticAutofixDiffApplyFromAuth } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(syntheticAutofixDiffApplyFromAuth("synthetic-diff")).toEqual({
			baseUrl: SYNTHETIC_PROVIDER.baseUrl,
			model: "synthetic-diff",
		});
		expect(
			syntheticAutofixDiffApplyFromAuth("synthetic-diff", {
				type: "command",
				command: ["op", "read", "secret"],
			}),
		).toEqual({
			baseUrl: SYNTHETIC_PROVIDER.baseUrl,
			model: "synthetic-diff",
			auth: {
				type: "command",
				command: ["op", "read", "secret"],
			},
		});
	});
});

describe("terminal model setup UI flows", () => {
	it("exports the model setup flow components from their owning module", async () => {
		const flowModule = await import(
			"../../menu/model_setup/add-model-flow.tsx"
		);
		const setupModule = await import(
			"../../menu/model_setup/auto-detect-models.tsx"
		);
		const autofixModule = await import(
			"../../menu/model_setup/autofix-model-menu.tsx"
		);

		expect(typeof flowModule.FullAddModelFlow).toBe("function");
		expect(typeof flowModule.CustomModelFlow).toBe("function");
		expect(typeof flowModule.CustomAuthFlow).toBe("function");
		expect(typeof flowModule.CustomAutofixFlow).toBe("function");
		expect(typeof setupModule.ModelSetup).toBe("function");
		expect(typeof autofixModule.AutofixModelMenu).toBe("function");
	});
});
