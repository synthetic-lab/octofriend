import { describe, expect, it } from "bun:test";

import { expectOk, expectPresent } from "./test-support.ts";

describe("autofix model setup helpers", () => {
	it("resolves Synthetic autofix from configured env var overrides", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = expectOk(
			keyFromName(expectPresent(SYNTHETIC_PROVIDER).name),
		);

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
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				auth: {
					type: "env",
					name: "SYNTHETIC_OVERRIDE",
					credential: "api-key",
				},
				model: "synthetic-diff",
			},
		});
	});

	it("tests Synthetic autofix model connectivity before completing env auth selection", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = expectOk(
			keyFromName(expectPresent(SYNTHETIC_PROVIDER).name),
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixSelection({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			defaultModel: "synthetic-diff",
			env: { SYNTHETIC_OVERRIDE: "present" },
			modelConnectionTest: (params) => {
				calls.push(params);
				return Promise.resolve({ valid: false });
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "present",
				model: "synthetic-diff",
			},
		]);
		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "Connection failed.",
		});
	});

	it("uses Synthetic base URL overrides for first-time autofix setup", async () => {
		const { resolveSyntheticAutofixConfig } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = expectOk(
			keyFromName(expectPresent(SYNTHETIC_PROVIDER).name),
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixConfig({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			env: {
				SYNTHETIC_OVERRIDE: "present",
				SYNTHETIC_BASE_URL: " http://127.0.0.1:8080/v1 ",
			},
			modelConnectionTest: (params) => {
				calls.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: "http://127.0.0.1:8080/v1",
				apiKey: "present",
				model: "hf:syntheticlab/diff-apply",
			},
			{
				type: "standard",
				baseUrl: "http://127.0.0.1:8080/v1",
				apiKey: "present",
				model: "hf:syntheticlab/fix-json",
			},
		]);
		expect(result).toEqual({
			step: "complete",
			config: {
				diffApply: {
					baseUrl: "http://127.0.0.1:8080/v1",
					auth: {
						type: "env",
						name: "SYNTHETIC_OVERRIDE",
						credential: "api-key",
					},
					model: "hf:syntheticlab/diff-apply",
				},
				fixJson: {
					baseUrl: "http://127.0.0.1:8080/v1",
					auth: {
						type: "env",
						name: "SYNTHETIC_OVERRIDE",
						credential: "api-key",
					},
					model: "hf:syntheticlab/fix-json",
				},
			},
		});
	});

	it("tests both default Synthetic autofix models before completing setup", async () => {
		const { resolveSyntheticAutofixConfig } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { keyFromName, SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const syntheticKey = expectOk(
			keyFromName(expectPresent(SYNTHETIC_PROVIDER).name),
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixConfig({
			config: {
				defaultApiKeyOverrides: {
					[syntheticKey]: "SYNTHETIC_OVERRIDE",
				},
			},
			env: { SYNTHETIC_OVERRIDE: "present" },
			modelConnectionTest: (params) => {
				calls.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "present",
				model: "hf:syntheticlab/diff-apply",
			},
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "present",
				model: "hf:syntheticlab/fix-json",
			},
		]);
		expect(result).toEqual({
			step: "complete",
			config: {
				diffApply: {
					baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
					auth: {
						type: "env",
						name: "SYNTHETIC_OVERRIDE",
						credential: "api-key",
					},
					model: "hf:syntheticlab/diff-apply",
				},
				fixJson: {
					baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
					auth: {
						type: "env",
						name: "SYNTHETIC_OVERRIDE",
						credential: "api-key",
					},
					model: "hf:syntheticlab/fix-json",
				},
			},
		});
	});

	it("uses a stored Synthetic key before asking for missing auth", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: {},
			readKeyForModel: (model) => {
				expect(model).toEqual({
					baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				});
				return Promise.resolve("stored-key");
			},
		});

		expect(result).toEqual({
			step: "complete",
			diffApply: {
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				model: "synthetic-diff",
			},
		});
	});

	it("tests Synthetic autofix model connectivity with stored key auth", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
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
			modelConnectionTest: (params) => {
				calls.push(params);
				return Promise.reject(new Error("billing required"));
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
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
			"../../menu/model_setup/synthetic-autofix.ts"
		);

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: {},
			readKeyForModel: async () => null,
		});

		expect(result).toEqual({ step: "missing-auth" });
	});

	it("surfaces stored Synthetic key lookup failures as setup errors", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: {},
			readKeyForModel: () => {
				throw new Error("keychain locked");
			},
		});

		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "keychain locked",
		});
	});

	it("ignores whitespace-only Synthetic autofix env auth", async () => {
		const { resolveSyntheticAutofixSelection } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);

		const result = await resolveSyntheticAutofixSelection({
			config: null,
			defaultModel: "synthetic-diff",
			env: { SYNTHETIC_API_KEY: " \n\t " },
			readKeyForModel: async () => null,
		});

		expect(result).toEqual({ step: "missing-auth" });
	});

	it("tests Synthetic autofix custom env auth before completing a single model", async () => {
		const { resolveSyntheticAutofixSelectionFromAuth } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixSelectionFromAuth({
			config: null,
			defaultModel: "synthetic-diff",
			auth: {
				type: "env",
				name: "SYNTHETIC_CUSTOM_AUTH_TEST_KEY",
				credential: "api-key",
			},
			env: { SYNTHETIC_CUSTOM_AUTH_TEST_KEY: "custom-env-key" },
			modelConnectionTest: (params) => {
				calls.push(params);
				return Promise.resolve({ valid: false });
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "custom-env-key",
				model: "synthetic-diff",
			},
		]);
		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "Connection failed.",
		});
	});

	it("rejects ChatGPT OAuth env auth for Synthetic autofix", async () => {
		const { resolveSyntheticAutofixSelectionFromAuth } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);

		const result = await resolveSyntheticAutofixSelectionFromAuth({
			config: null,
			defaultModel: "synthetic-diff",
			auth: {
				type: "env",
				name: "CODEX_ACCESS_TOKEN",
				credential: "chatgpt-oauth",
			},
			env: { CODEX_ACCESS_TOKEN: "oauth-token" },
			modelConnectionTest: () => {
				throw new Error("connection test should not receive OAuth as API key");
			},
		});

		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "ChatGPT OAuth is only supported for OpenAI providers.",
		});
	});

	it("tests Synthetic autofix custom command auth before completing a single model", async () => {
		const { resolveSyntheticAutofixSelectionFromAuth } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixSelectionFromAuth({
			config: null,
			defaultModel: "synthetic-diff",
			auth: { type: "command", command: ["printf", "custom-command-key"] },
			env: {},
			modelConnectionTest: (params) => {
				calls.push(params);
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "custom-command-key",
				model: "synthetic-diff",
			},
		]);
		expect(result).toEqual({
			step: "complete",
			diffApply: {
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				auth: { type: "command", command: ["printf", "custom-command-key"] },
				model: "synthetic-diff",
			},
		});
	});

	it("tests both Synthetic autofix models for custom auth before completing setup", async () => {
		const { resolveSyntheticAutofixConfigFromAuth } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);
		const calls: unknown[] = [];

		const result = await resolveSyntheticAutofixConfigFromAuth({
			config: null,
			auth: {
				type: "env",
				name: "SYNTHETIC_CUSTOM_SETUP_KEY",
				credential: "api-key",
			},
			env: { SYNTHETIC_CUSTOM_SETUP_KEY: "custom-setup-key" },
			modelConnectionTest: (params) => {
				calls.push(params);
				if (params.model === "hf:syntheticlab/fix-json") {
					return Promise.reject(new Error("payment required"));
				}
				return Promise.resolve({ valid: true, metadata: {} });
			},
		});

		expect(calls).toEqual([
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "custom-setup-key",
				model: "hf:syntheticlab/diff-apply",
			},
			{
				type: "standard",
				baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
				apiKey: "custom-setup-key",
				model: "hf:syntheticlab/fix-json",
			},
		]);
		expect(result).toEqual({
			step: "connection-failed",
			errorMessage: "payment required",
		});
	});

	it("builds Synthetic autofix config from custom auth results", async () => {
		const { syntheticAutofixDiffApplyFromAuth } = await import(
			"../../menu/model_setup/synthetic-autofix.ts"
		);
		const { SYNTHETIC_PROVIDER } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(
			syntheticAutofixDiffApplyFromAuth(
				"synthetic-diff",
				undefined,
				expectPresent(SYNTHETIC_PROVIDER),
			),
		).toEqual({
			baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
			model: "synthetic-diff",
		});
		expect(
			syntheticAutofixDiffApplyFromAuth(
				"synthetic-diff",
				{
					type: "command",
					command: ["op", "read", "secret"],
				},
				expectPresent(SYNTHETIC_PROVIDER),
			),
		).toEqual({
			baseUrl: expectPresent(SYNTHETIC_PROVIDER).baseUrl,
			model: "synthetic-diff",
			auth: {
				type: "command",
				command: ["op", "read", "secret"],
			},
		});
	});
});
