import { describe, expect, it } from "bun:test";

type TestResult<T, E> =
	| { success: true; data: T }
	| { success: false; error: E };

function expectOk<T, E>(result: TestResult<T, E>): T {
	expect(result.success).toBe(true);
	return result.success ? result.data : (undefined as T);
}

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

	it("returns API key URLs for known providers", async () => {
		const { getProviderApiKeyUrl } = await import(
			"../../menu/model_setup/primitives.tsx"
		);

		expect(getProviderApiKeyUrl("https://api.synthetic.new/v1")).toBe(
			"https://dev.synthetic.new/",
		);
		expect(getProviderApiKeyUrl("https://api.openai.com/v1")).toBe(
			"https://platform.openai.com/api-keys",
		);
		expect(getProviderApiKeyUrl("https://api.anthropic.com")).toBe(
			"https://console.anthropic.com/settings/keys",
		);
		expect(
			getProviderApiKeyUrl("https://generativelanguage.googleapis.com/v1beta"),
		).toBe("https://aistudio.google.com/apikey");
		expect(getProviderApiKeyUrl("https://api.x.ai/v1")).toBe(
			"https://console.x.ai/",
		);
		expect(getProviderApiKeyUrl("https://models.example.test/v1")).toBeNull();
	});

	it("formats API key URLs as OSC 8 terminal hyperlinks", async () => {
		const { terminalHyperlink } = await import(
			"../../menu/model_setup/primitives.tsx"
		);

		expect(terminalHyperlink("https://platform.openai.com/api-keys")).toBe(
			"\u001B]8;;https://platform.openai.com/api-keys\u0007https://platform.openai.com/api-keys\u001B]8;;\u0007",
		);
		expect(
			terminalHyperlink("https://platform.openai.com/api-keys", "OpenAI keys"),
		).toBe(
			"\u001B]8;;https://platform.openai.com/api-keys\u0007OpenAI keys\u001B]8;;\u0007",
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

	it("returns provider error text from failed connection tests", async () => {
		const { testConnection } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);

		const oldKey = process.env["MODEL_SETUP_TEST_KEY"];
		process.env["MODEL_SETUP_TEST_KEY"] = "test-key";
		try {
			const result = await testConnection({
				baseUrl: "https://api.example.test/v1",
				model: "example-model",
				config: null,
				auth: { type: "env", name: "MODEL_SETUP_TEST_KEY" },
				modelConnectionTest: async () =>
					Promise.reject(new Error("invalid key or billing required")),
			});

			expect(result).toEqual({
				valid: false,
				errorMessage: "invalid key or billing required",
			});
		} finally {
			if (oldKey === undefined) delete process.env["MODEL_SETUP_TEST_KEY"];
			else process.env["MODEL_SETUP_TEST_KEY"] = oldKey;
		}
	});

	it("passes native provider type to connection tests for known Gemini base URLs", async () => {
		const { testConnection } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);
		const requests: unknown[] = [];

		const oldKey = process.env["MODEL_SETUP_GEMINI_TEST_KEY"];
		process.env["MODEL_SETUP_GEMINI_TEST_KEY"] = "test-key";
		try {
			const result = await testConnection({
				baseUrl: "https://generativelanguage.googleapis.com/v1beta",
				model: "gemini-3.5-flash",
				config: null,
				auth: { type: "env", name: "MODEL_SETUP_GEMINI_TEST_KEY" },
				modelConnectionTest: (params) => {
					requests.push(params);
					return Promise.resolve({ valid: true, metadata: {} });
				},
			});

			expect(result).toEqual({ valid: true, metadata: {} });
			expect(requests).toEqual([
				{
					type: "gemini",
					baseUrl: "https://generativelanguage.googleapis.com/v1beta",
					apiKey: "test-key",
					model: "gemini-3.5-flash",
				},
			]);
		} finally {
			if (oldKey === undefined)
				delete process.env["MODEL_SETUP_GEMINI_TEST_KEY"];
			else process.env["MODEL_SETUP_GEMINI_TEST_KEY"] = oldKey;
		}
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
		const openaiKey = expectOk(keyFromName(PROVIDERS.openai.name));
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
		const syntheticKey = expectOk(keyFromName(SYNTHETIC_PROVIDER.name));

		const result = await resolveSyntheticAutofixSelection({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			defaultModel: "synthetic-diff",
			env: { SYNTHETIC_OVERRIDE: "present" },
			readKeyForModel: () =>
				Promise.reject(
					new Error("key file should not be read when env auth exists"),
				),
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

	it("tests Synthetic autofix model connectivity before completing env auth selection", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = expectOk(keyFromName(SYNTHETIC_PROVIDER.name));
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixSelection({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			defaultModel: "synthetic-diff",
			env: { SYNTHETIC_OVERRIDE: "present" },
			modelConnectionTest: async (params) => {
				calls.push(params);
				return { valid: false };
			},
		});

		expect(calls).toEqual([
			{
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiKey: "present",
				model: "synthetic-diff",
			},
		]);
		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "Connection failed.",
		});
	});

	it("tests both default Synthetic autofix models before completing setup", async () => {
		const { resolveSyntheticAutofixConfig } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = expectOk(keyFromName(SYNTHETIC_PROVIDER.name));
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixConfig({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			env: { SYNTHETIC_OVERRIDE: "present" },
			modelConnectionTest: async (params) => {
				calls.push(params);
				return { valid: true, metadata: {} };
			},
		});

		expect(calls).toEqual([
			{
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiKey: "present",
				model: "hf:syntheticlab/diff-apply",
			},
			{
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiKey: "present",
				model: "hf:syntheticlab/fix-json",
			},
		]);
		expect(result).toEqual({
			step: "complete",
			config: {
				diffApply: {
					baseUrl: SYNTHETIC_PROVIDER.baseUrl,
					apiEnvVar: "SYNTHETIC_OVERRIDE",
					model: "hf:syntheticlab/diff-apply",
				},
				fixJson: {
					baseUrl: SYNTHETIC_PROVIDER.baseUrl,
					apiEnvVar: "SYNTHETIC_OVERRIDE",
					model: "hf:syntheticlab/fix-json",
				},
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

	it("tests Synthetic autofix model connectivity with stored key auth", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: {},
			readKeyForModel: async () => "stored-key",
			modelConnectionTest: async (params) => {
				calls.push(params);
				return Promise.reject(new Error("billing required"));
			},
		});

		expect(calls).toEqual([
			{
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiKey: "stored-key",
				model: "synthetic-diff",
			},
		]);
		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "billing required",
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

	it("tests Synthetic autofix custom env auth before completing a single model", async () => {
		const { resolveSyntheticAutofixSelectionFromAuth } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const oldKey = process.env["SYNTHETIC_CUSTOM_AUTH_TEST_KEY"];
		process.env["SYNTHETIC_CUSTOM_AUTH_TEST_KEY"] = "custom-env-key";
		const calls: unknown[] = [];

		try {
			const result = await resolveSyntheticAutofixSelectionFromAuth({
				config: null,
				defaultModel: "synthetic-diff",
				auth: { type: "env", name: "SYNTHETIC_CUSTOM_AUTH_TEST_KEY" },
				modelConnectionTest: async (params) => {
					calls.push(params);
					return { valid: false };
				},
			});

			expect(calls).toEqual([
				{
					baseUrl: SYNTHETIC_PROVIDER.baseUrl,
					apiKey: "custom-env-key",
					model: "synthetic-diff",
				},
			]);
			expect(result).toEqual({
				step: "connection-failed",
				errorMessage: "Connection failed.",
			});
		} finally {
			if (oldKey === undefined)
				delete process.env["SYNTHETIC_CUSTOM_AUTH_TEST_KEY"];
			else process.env["SYNTHETIC_CUSTOM_AUTH_TEST_KEY"] = oldKey;
		}
	});

	it("tests Synthetic autofix custom command auth before completing a single model", async () => {
		const { resolveSyntheticAutofixSelectionFromAuth } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixSelectionFromAuth({
			config: null,
			defaultModel: "synthetic-diff",
			auth: { type: "command", command: ["printf", "custom-command-key"] },
			modelConnectionTest: async (params) => {
				calls.push(params);
				return { valid: true, metadata: {} };
			},
		});

		expect(calls).toEqual([
			{
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				apiKey: "custom-command-key",
				model: "synthetic-diff",
			},
		]);
		expect(result).toEqual({
			step: "complete",
			diffApply: {
				baseUrl: SYNTHETIC_PROVIDER.baseUrl,
				auth: { type: "command", command: ["printf", "custom-command-key"] },
				model: "synthetic-diff",
			},
		});
	});

	it("tests both Synthetic autofix models for custom auth before completing setup", async () => {
		const { resolveSyntheticAutofixConfigFromAuth } = await import(
			"../../menu/model_setup/primitives.tsx"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const oldKey = process.env["SYNTHETIC_CUSTOM_SETUP_KEY"];
		process.env["SYNTHETIC_CUSTOM_SETUP_KEY"] = "custom-setup-key";
		const calls: unknown[] = [];

		try {
			const result = await resolveSyntheticAutofixConfigFromAuth({
				config: null,
				auth: { type: "env", name: "SYNTHETIC_CUSTOM_SETUP_KEY" },
				modelConnectionTest: async (params) => {
					calls.push(params);
					if (params.model === "hf:syntheticlab/fix-json") {
						return Promise.reject(new Error("payment required"));
					}
					return { valid: true, metadata: {} };
				},
			});

			expect(calls).toEqual([
				{
					baseUrl: SYNTHETIC_PROVIDER.baseUrl,
					apiKey: "custom-setup-key",
					model: "hf:syntheticlab/diff-apply",
				},
				{
					baseUrl: SYNTHETIC_PROVIDER.baseUrl,
					apiKey: "custom-setup-key",
					model: "hf:syntheticlab/fix-json",
				},
			]);
			expect(result).toEqual({
				step: "connection-failed",
				errorMessage: "payment required",
			});
		} finally {
			if (oldKey === undefined)
				delete process.env["SYNTHETIC_CUSTOM_SETUP_KEY"];
			else process.env["SYNTHETIC_CUSTOM_SETUP_KEY"] = oldKey;
		}
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
	it("renders Synthetic autofix connection errors in the per-model menu", async () => {
		const React = await import("react");
		const { Text } = await import("ink");
		const { render } = await import("ink-testing-library");
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const { ModelConnectionTestContext } = await import(
			"../../menu/model_setup/add-model-connection.ts"
		);
		const { AutofixModelMenu } = await import(
			"../../menu/model_setup/autofix-model-menu.tsx"
		);
		const syntheticKey = expectOk(keyFromName(SYNTHETIC_PROVIDER.name));
		const oldKey = process.env["SYNTHETIC_UI_ERROR_KEY"];
		process.env["SYNTHETIC_UI_ERROR_KEY"] = "ui-key";

		try {
			const instance = render(
				React.createElement(
					ModelConnectionTestContext.Provider,
					{
						value: async () => Promise.reject(new Error("billing required")),
					},
					React.createElement(AutofixModelMenu, {
						config: {
							yourName: "Test User",
							models: [],
							defaultApiKeyOverrides: {
								[syntheticKey]: "SYNTHETIC_UI_ERROR_KEY",
							},
						},
						defaultModel: "hf:syntheticlab/diff-apply",
						modelNickname: "diff-apply",
						onCancel: () => undefined,
						onComplete: () => undefined,
						onOverrideDefaultApiKey: async () => undefined,
						children: React.createElement(Text, null, "diff apply setup"),
					}),
				),
			);

			instance.stdin.write("e");
			await new Promise((resolve) => setTimeout(resolve, 25));

			expect(instance.lastFrame() ?? "").toContain("billing required");
		} finally {
			if (oldKey === undefined) delete process.env["SYNTHETIC_UI_ERROR_KEY"];
			else process.env["SYNTHETIC_UI_ERROR_KEY"] = oldKey;
		}
	});

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
