import { describe, expect, it } from "bun:test";
import type { ProviderConfig } from "../../src/runtime/models/catalog/main";
import {
	expectOk,
	expectPresent,
	waitFor,
} from "./helpers";

describe("provider setup helpers", () => {
	it("resolves provider base URLs from local proxy environment overrides", async () => {
		const { resolveProviderBaseUrl } = await import(
			"../../src/menu/models/detect-models"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);

		expect(
			resolveProviderBaseUrl("openai", expectPresent(PROVIDERS.openai), {
				OPENAI_BASE_URL: " http://127.0.0.1:8080/v1 ",
			}),
		).toBe("http://127.0.0.1:8080/v1");
		expect(
			resolveProviderBaseUrl("anthropic", expectPresent(PROVIDERS.anthropic), {
				ANTHROPIC_BASE_URL: "http://127.0.0.1:8080",
			}),
		).toBe("http://127.0.0.1:8080");
		expect(
			resolveProviderBaseUrl("gemini", expectPresent(PROVIDERS.gemini), {
				GEMINI_BASE_URL: "http://127.0.0.1:8080/v1beta",
			}),
		).toBe("http://127.0.0.1:8080/v1beta");
		expect(
			resolveProviderBaseUrl("openai", expectPresent(PROVIDERS.openai), {}),
		).toBe(expectPresent(PROVIDERS.openai).baseUrl);
	});

	it("deduplicates provider imports across aliases and local base URL overrides", async () => {
		const { getRemainingProviderModels } = await import(
			"../../src/menu/models/import"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const synthetic = expectPresent(PROVIDERS.synthetic);
		const openai = expectPresent(PROVIDERS.openai);
		const syntheticModel = expectPresent(synthetic.models[0]);
		const openaiModel = expectPresent(openai.models[0]);

		expect(
			getRemainingProviderModels(
				{
					yourName: "Test User",
					models: [
						{
							...syntheticModel,
							baseUrl: "https://api.synthetic.new/openai/v1",
						},
					],
				},
				synthetic,
			).some((model) => model.model === syntheticModel.model),
		).toBe(false);

		expect(
			getRemainingProviderModels(
				{
					yourName: "Test User",
					models: [
						{
							...openaiModel,
							baseUrl: openai.baseUrl,
							type: openai.type,
						},
					],
				},
				{ ...openai, baseUrl: "http://127.0.0.1:8080/v1" },
			).some((model) => model.model === openaiModel.model),
		).toBe(false);

		expect(
			getRemainingProviderModels(
				{
					yourName: "Test User",
					models: [
						{
							...openaiModel,
							baseUrl: ` ${openai.baseUrl}/ `,
						},
					],
				},
				openai,
			).some((model) => model.model === openaiModel.model),
		).toBe(false);

		expect(
			getRemainingProviderModels(
				{
					yourName: "Test User",
					models: [
						{
							...openaiModel,
							baseUrl: "https://custom-openai-compatible.example/v1",
							type: "standard",
						},
					],
				},
				openai,
			).some((model) => model.model === openaiModel.model),
		).toBe(true);
	});

	it("does not show stale selected models after switching import providers", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ImportModelsFrom } = await import(
			"../../src/menu/models/import-screen"
		);
		const providerA: ProviderConfig = {
			shortcut: "a",
			name: "Provider A",
			envVar: "PROVIDER_A_API_KEY",
			baseUrl: "https://provider-a.example.test/v1",
			baseUrlAliases: [],
			apiKeyUrl: "https://provider-a.example.test/keys",
			authMethods: ["api-key"],
			models: [{ nickname: "Shared", model: "model-a", context: 128000 }],
			testModel: "model-a",
		};
		const providerB: ProviderConfig = {
			...providerA,
			name: "Provider B",
			envVar: "PROVIDER_B_API_KEY",
			baseUrl: "https://provider-b.example.test/v1",
			apiKeyUrl: "https://provider-b.example.test/keys",
			models: [{ nickname: "Shared", model: "model-b", context: 128000 }],
			testModel: "model-b",
		};

		const instance = render(
			React.createElement(ImportModelsFrom, {
				config: null,
				provider: providerA,
				onImport: () => undefined,
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => undefined,
			}),
		);
		await waitFor(() => (instance.lastFrame() ?? "").includes("○ Shared"));
		instance.stdin.write("\r");
		await waitFor(() => (instance.lastFrame() ?? "").includes("⦿ Shared"));

		instance.rerender(
			React.createElement(ImportModelsFrom, {
				config: null,
				provider: providerB,
				onImport: () => undefined,
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => undefined,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Provider B models can be imported!");
		expect(frame).toContain("○ Shared");
		expect(frame).not.toContain("⦿ Shared");
	});

	it("uses latest import callback after provider import rerender", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ImportModelsFrom } = await import(
			"../../src/menu/models/import-screen"
		);
		const provider: ProviderConfig = {
			shortcut: "p",
			name: "Provider",
			envVar: "PROVIDER_API_KEY",
			baseUrl: "https://provider.example.test/v1",
			baseUrlAliases: [],
			apiKeyUrl: "https://provider.example.test/keys",
			authMethods: ["api-key"],
			models: [{ nickname: "Fast", model: "provider-fast", context: 128000 }],
			testModel: "provider-fast",
		};
		const imports: string[] = [];

		const instance = render(
			React.createElement(ImportModelsFrom, {
				config: null,
				provider,
				onImport: (models: ProviderConfig["models"]) => {
					imports.push(`first:${models.map((model) => model.model).join(",")}`);
				},
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => undefined,
			}),
		);
		await waitFor(() => (instance.lastFrame() ?? "").includes("○ Fast"));
		instance.stdin.write("\r");
		await waitFor(() => (instance.lastFrame() ?? "").includes("⦿ Fast"));

		instance.rerender(
			React.createElement(ImportModelsFrom, {
				config: null,
				provider,
				onImport: (models: ProviderConfig["models"]) => {
					imports.push(
						`second:${models.map((model) => model.model).join(",")}`,
					);
				},
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => undefined,
			}),
		);
		instance.stdin.write("2");
		await waitFor(() => imports.length === 1);

		expect(imports).toEqual(["second:provider-fast"]);
	});

	it("lets users change authentication before importing provider models", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ImportModelsFrom } = await import(
			"../../src/menu/models/import-screen"
		);
		const provider: ProviderConfig = {
			shortcut: "p",
			name: "Provider",
			envVar: "PROVIDER_API_KEY",
			baseUrl: "https://provider.example.test/v1",
			baseUrlAliases: [],
			apiKeyUrl: "https://provider.example.test/keys",
			authMethods: ["api-key"],
			models: [{ nickname: "Fast", model: "provider-fast", context: 128000 }],
			testModel: "provider-fast",
		};
		let changeAuthCount = 0;

		const instance = render(
			React.createElement(ImportModelsFrom, {
				config: null,
				provider,
				onImport: () => undefined,
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => {
					changeAuthCount += 1;
				},
			}),
		);

		await waitFor(() =>
			(instance.lastFrame() ?? "").includes("Change authentication"),
		);
		instance.stdin.write("\x1B[B");
		await Bun.sleep(1);
		instance.stdin.write("\x1B[B");
		await Bun.sleep(1);
		instance.stdin.write("\r");
		await waitFor(() => changeAuthCount === 1);

		expect(changeAuthCount).toBe(1);
	});

	it("resolves provider env vars from explicit override, config override, then provider default", async () => {
		const { resolveProviderEnvVar } = await import(
			"../../src/menu/models/providers"
		);
		const { keyFromName, PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const openaiKey = expectOk(
			keyFromName(expectPresent(PROVIDERS.openai).name),
		);
		const config = {
			defaultApiKeyOverrides: {
				[openaiKey]: " OPENAI_FROM_CONFIG ",
			},
		};

		expect(
			resolveProviderEnvVar(
				expectPresent(PROVIDERS.openai),
				config,
				" OPENAI_EXPLICIT ",
			),
		).toBe("OPENAI_EXPLICIT");
		expect(
			resolveProviderEnvVar(expectPresent(PROVIDERS.openai), config, null),
		).toBe("OPENAI_FROM_CONFIG");
		expect(
			resolveProviderEnvVar(
				expectPresent(PROVIDERS.openai),
				{ defaultApiKeyOverrides: { [openaiKey]: " \n\t " } },
				" \n\t ",
			),
		).toBe(expectPresent(PROVIDERS.openai).envVar);
		expect(
			resolveProviderEnvVar(expectPresent(PROVIDERS.openai), null, null),
		).toBe(expectPresent(PROVIDERS.openai).envVar);
	});

	it("returns non-empty environment values without trimming allocations when possible", async () => {
		const { nonEmptyEnvValue } = await import(
			"../../src/menu/models/providers"
		);
		const raw = "OPENAI_API_KEY";

		expect(nonEmptyEnvValue("MISSING", {})).toBeNull();
		expect(nonEmptyEnvValue("BLANK", { BLANK: " \n\t " })).toBeNull();
		expect(nonEmptyEnvValue("KEY", { KEY: raw })).toBe(raw);
		expect(
			nonEmptyEnvValue("KEY", { KEY: "\uFEFF\u00A0OPENAI_API_KEY\u00A0" }),
		).toBe(raw);
	});

	it("adds provider type metadata to custom provider models", async () => {
		const { buildCustomProviderModel } = await import(
			"../../src/menu/models/import"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const customModel = {
			baseUrl: "https://api.openai.com/v1",
			model: "custom-gpt",
			nickname: "Custom GPT",
			context: 128000,
		};

		expect(
			buildCustomProviderModel(customModel, expectPresent(PROVIDERS.openai)),
		).toEqual({ ...customModel, type: "openai-responses" });
		expect(
			buildCustomProviderModel(customModel, {
				...expectPresent(PROVIDERS.openai),
				type: undefined,
			}),
		).toBe(customModel);
	});

	it("builds imported provider models with provider auth metadata", async () => {
		const { buildImportedProviderModels, providerModelAuth } = await import(
			"../../src/menu/models/import-auth"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const openaiConfig = {
			yourName: "Test User",
			models: [],
			defaultApiKeyOverrides: {},
		};

		expect(
			buildImportedProviderModels({
				models: [
					{
						model: "gpt-test",
						nickname: "GPT Test",
						context: 128000,
					},
				],
				provider: openai,
				config: openaiConfig,
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toEqual([
			{
				model: "gpt-test",
				nickname: "GPT Test (OpenAI)",
				context: 128000,
				baseUrl: openai.baseUrl,
				type: "openai-responses",
			},
		]);
		expect(
			providerModelAuth({
				provider: openai,
				config: openaiConfig,
				overrideAuth: null,
				useEnvVar: true,
			}),
		).toBeUndefined();
		expect(
			providerModelAuth({
				provider: openai,
				config: openaiConfig,
				overrideAuth: { type: "env", name: "OPENAI_MANUAL" },
				useEnvVar: true,
			}),
		).toBeUndefined();
		expect(
			providerModelAuth({
				provider: openai,
				config: openaiConfig,
				overrideAuth: null,
				useEnvVar: false,
			}),
		).toBeUndefined();

		expect(
			buildImportedProviderModels({
				models: [
					{
						model: "claude-test",
						nickname: "Claude Test",
						context: 200000,
					},
				],
				provider: expectPresent(PROVIDERS.anthropic),
				config: null,
				overrideAuth: { type: "env", name: "ANTHROPIC_CUSTOM" },
				useEnvVar: false,
			}),
		).toEqual([
			{
				model: "claude-test",
				nickname: "Claude Test (Anthropic)",
				context: 200000,
				baseUrl: "https://api.anthropic.com",
				type: "anthropic",
			},
		]);
	});

	it("builds empty-provider import shortcuts without inline route data", async () => {
		const { buildEmptyProviderImportShortcutItems } = await import(
			"../../src/menu/models/import"
		);

		expect(buildEmptyProviderImportShortcutItems("OpenAI")).toEqual([
			{
				type: "key",
				mapping: {
					c: {
						label: "Add a custom model string from OpenAI",
						value: "custom",
					},
					a: {
						label: "Change authentication...",
						value: "change-auth",
					},
					b: { label: "Back", value: "back" },
				},
			},
		]);
	});

	it("builds provider import model values without colliding with control actions", async () => {
		const {
			buildImportModelItems,
			EMPTY_SELECTED_PROVIDER_MODELS,
			selectedProviderModels,
			toggleSelectedProviderModel,
		} = await import("../../src/menu/models/import");
		const providerModels = [
			{
				model: "provider-back",
				nickname: "back",
				context: 128000,
			},
			{
				model: "provider-custom",
				nickname: "custom",
				context: 128000,
			},
		];

		expect(
			buildImportModelItems(providerModels, new Set(["provider-custom"])),
		).toEqual([
			{ label: "○ back", value: "provider-model:provider-back" },
			{ label: "⦿ custom", value: "provider-model:provider-custom" },
			{ label: "Import selected models", value: "import" },
			{ label: "Import a custom model string...", value: "custom" },
			{ label: "Change authentication...", value: "change-auth" },
			{ label: "Back", value: "back" },
		]);

		expect(
			buildImportModelItems(providerModels, new Set(["missing-model"])),
		).toEqual([
			{ label: "○ back", value: "provider-model:provider-back" },
			{ label: "○ custom", value: "provider-model:provider-custom" },
			{ label: "Import a custom model string...", value: "custom" },
			{ label: "Change authentication...", value: "change-auth" },
			{ label: "Back", value: "back" },
		]);
		expect(
			selectedProviderModels(providerModels, new Set(["provider-custom"])),
		).toEqual([providerModels[1]]);
		const selected = toggleSelectedProviderModel(
			EMPTY_SELECTED_PROVIDER_MODELS,
			"provider-custom",
		);
		expect(Array.from(selected)).toEqual(["provider-custom"]);
		expect(toggleSelectedProviderModel(selected, "provider-custom")).toBe(
			EMPTY_SELECTED_PROVIDER_MODELS,
		);
	});
	it("selects duplicate nicknames independently by model id", async () => {
		const {
			buildImportModelItems,
			selectedProviderModels,
			toggleSelectedProviderModel,
			EMPTY_SELECTED_PROVIDER_MODELS,
		} = await import("../../src/menu/models/import");
		const providerModels = [
			{ model: "model-a", nickname: "Shared", context: 128000 },
			{ model: "model-b", nickname: "Shared", context: 128000 },
		];

		const selected = toggleSelectedProviderModel(
			EMPTY_SELECTED_PROVIDER_MODELS,
			"model-b",
		);

		expect(buildImportModelItems(providerModels, selected)).toEqual([
			{ label: "○ Shared", value: "provider-model:model-a" },
			{ label: "⦿ Shared", value: "provider-model:model-b" },
			{ label: "Import selected models", value: "import" },
			{ label: "Import a custom model string...", value: "custom" },
			{ label: "Change authentication...", value: "change-auth" },
			{ label: "Back", value: "back" },
		]);
		expect(selectedProviderModels(providerModels, selected)).toEqual([
			providerModels[1],
		]);
	});
	it("renders the provider import authentication summary after all recommended models are imported", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ImportModelsFrom } = await import(
			"../../src/menu/models/import-screen"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const openai = expectPresent(PROVIDERS.openai);
		const imported = openai.models.map((model) => ({
			...model,
			nickname: `${model.nickname} (${openai.name})`,
			baseUrl: openai.baseUrl,
		}));

		const instance = render(
			React.createElement(ImportModelsFrom, {
				config: { yourName: "Ada", models: imported },
				provider: openai,
				onImport: () => undefined,
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => undefined,
				authSummaryText:
					"Authentication: ChatGPT OAuth\r\nvia CODEX_ACCESS_TOKEN",
			}),
		);

		expect(instance.lastFrame()).toContain("Authentication: ChatGPT OAuth");
		expect(instance.lastFrame()).toContain("via CODEX_ACCESS_TOKEN");
		expect(instance.lastFrame()).not.toContain("\r");
	});

	it("renders the provider import authentication summary", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ImportModelsFrom } = await import(
			"../../src/menu/models/import-screen"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const openai = expectPresent(PROVIDERS.openai);

		const instance = render(
			React.createElement(ImportModelsFrom, {
				config: { yourName: "Ada", models: [] },
				provider: {
					...openai,
					models: [
						{ model: "gpt-test", nickname: "GPT Test", context: 128000 },
					],
				},
				onImport: () => undefined,
				onCancel: () => undefined,
				onCustomModel: () => undefined,
				onChangeAuth: () => undefined,
				authSummaryText: "Authentication: ChatGPT OAuth via CODEX_ACCESS_TOKEN",
			}),
		);

		expect(instance.lastFrame()).toContain(
			"Authentication: ChatGPT OAuth via CODEX_ACCESS_TOKEN",
		);
	});
});
