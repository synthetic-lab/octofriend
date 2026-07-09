import { describe, expect, it } from "bun:test";

describe("provider selection shortcuts", () => {
	it("builds static provider shortcuts with custom and back actions", async () => {
		const {
			buildFastProviderShortcutItems,
			modelSetupStepForProviderChoice,
			providerShortcutLabel,
		} = await import("../../menu/model_setup/provider-selection.ts");

		expect(
			buildFastProviderShortcutItems([
				[
					"openai",
					{
						name: "OpenAI",
						baseUrl: "https://api.openai.com/v1",
						baseUrlAliases: [],
						envVar: "OPENAI_API_KEY",
						apiKeyUrl: "https://platform.openai.com/api-keys",
						authMethods: ["api-key", "chatgpt-oauth"],
						models: [
							{
								model: "gpt-5-mini",
								nickname: "GPT-5 mini",
								context: 128000,
							},
						],
						shortcut: "o",
						testModel: "gpt-5-mini",
					},
				],
			]),
		).toEqual([
			{
				type: "key",
				mapping: {
					o: {
						label: "OpenAI · ChatGPT OAuth or OPENAI_API_KEY · GPT-5 mini",
						value: "openai",
					},
					c: {
						label: "Add a custom model...",
						value: "custom",
					},
					b: {
						label: "Back",
						value: "back",
					},
				},
			},
		]);

		expect(
			providerShortcutLabel({
				name: "Anthropic",
				baseUrl: "https://api.anthropic.com",
				baseUrlAliases: [],
				envVar: "ANTHROPIC_API_KEY",
				apiKeyUrl: "https://console.anthropic.com/settings/keys",
				authMethods: ["api-key"],
				models: [],
				shortcut: "a",
				testModel: "claude-test",
			}),
		).toBe("Anthropic · ANTHROPIC_API_KEY");

		expect(
			buildFastProviderShortcutItems(
				[
					[
						"openai",
						{
							name: "OpenAI",
							baseUrl: "https://api.openai.com/v1",
							baseUrlAliases: [],
							envVar: "OPENAI_API_KEY",
							apiKeyUrl: "https://platform.openai.com/api-keys",
							authMethods: ["api-key", "chatgpt-oauth"],
							models: [],
							shortcut: "o",
							testModel: "gpt-5-mini",
						},
					],
				],
				{ defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" } },
			),
		).toMatchObject([
			{
				mapping: {
					o: {
						label: "OpenAI · ChatGPT OAuth or OPENAI_FROM_CONFIG",
					},
				},
			},
		]);

		expect(
			buildFastProviderShortcutItems(
				[
					[
						"openai",
						{
							name: "OpenAI",
							baseUrl: "https://api.openai.com/v1",
							baseUrlAliases: [],
							envVar: "OPENAI_API_KEY",
							apiKeyUrl: "https://platform.openai.com/api-keys",
							authMethods: ["chatgpt-oauth"],
							models: [],
							shortcut: "o",
							testModel: "gpt-5-mini",
						},
					],
				],
				{ defaultApiKeyOverrides: { openai: "OPENAI_FROM_CONFIG" } },
			),
		).toMatchObject([
			{
				mapping: {
					o: {
						label: "OpenAI · ChatGPT OAuth",
					},
				},
			},
		]);

		expect(
			providerShortcutLabel(
				{
					name: "Anthropic",
					baseUrl: "https://api.anthropic.com",
					baseUrlAliases: [],
					envVar: "ANTHROPIC_API_KEY",
					apiKeyUrl: "https://console.anthropic.com/settings/keys",
					authMethods: ["api-key"],
					models: [],
					shortcut: "a",
					testModel: "claude-test",
				},
				{ defaultApiKeyOverrides: { anthropic: "ANTHROPIC_FROM_CONFIG" } },
			),
		).toBe("Anthropic · ANTHROPIC_FROM_CONFIG");
		const missingStep = modelSetupStepForProviderChoice({
			providerKey: "openai",
			config: null,
			env: {},
		});
		expect(missingStep?.step).toBe("missing");
		expect(missingStep?.provider.name).toBe("OpenAI");

		const foundStep = modelSetupStepForProviderChoice({
			providerKey: "openai",
			config: null,
			env: {
				OPENAI_API_KEY: "sk-test",
				OPENAI_BASE_URL: "http://127.0.0.1:8080/v1",
			},
		});
		expect(foundStep).toMatchObject({
			step: "found",
			overrideAuth: null,
			useEnvVar: true,
			provider: {
				name: "OpenAI",
				baseUrl: "http://127.0.0.1:8080/v1",
				baseUrlAliases: ["https://api.openai.com/v1"],
			},
		});
	});
});
