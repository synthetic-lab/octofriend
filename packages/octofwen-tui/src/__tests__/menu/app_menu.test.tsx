import { describe, expect, test } from "bun:test";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	appMenuFlow,
	filterSettingsItems,
	Menu,
} from "../../menu/app_menu/main.tsx";
import { resolveSwitchModelSelection } from "../../menu/app_menu/model-switching.tsx";

const config = {
	models: [
		{
			nickname: "one",
			baseUrl: "https://api.example.test/v1",
			model: "example-1",
			context: 128_000,
		},
	],
} as Config;

describe("terminal app menu", () => {
	test("exports the terminal app menu component", () => {
		expect(Menu).toBeFunction();
		expect(appMenuFlow.route).toBeFunction();
	});

	test("settings items omit model management when only one model exists", () => {
		expect(Object.keys(filterSettingsItems(config))).toEqual([]);
	});

	test("settings items include model and autofix controls when configurable", () => {
		const items = filterSettingsItems({
			...config,
			models: [
				...config.models,
				{
					nickname: "two",
					baseUrl: "https://api.example.test/v1",
					model: "example-2",
					context: 128_000,
				},
			],
			diffApply: {
				baseUrl: "https://synthetic.new/v1",
				model: "hf:syntheticlab/diff-apply",
				apiEnvVar: "SYNTHETIC_API_KEY",
			},
			fixJson: {
				baseUrl: "https://synthetic.new/v1",
				model: "hf:syntheticlab/fix-json",
				apiEnvVar: "SYNTHETIC_API_KEY",
			},
		});

		expect(Object.values(items).map((item) => item.value)).toEqual([
			"set-default-model",
			"remove-model",
			"disable-diff-apply",
			"disable-fix-json",
		]);
	});

	test("model switch selection blocks missing configured environment auth", async () => {
		const result = await resolveSwitchModelSelection({
			config: {
				...config,
				models: [
					...config.models,
					{
						nickname: "env-model",
						baseUrl: "https://api.env.example.test/v1",
						apiEnvVar: "MISSING_MODEL_KEY",
						model: "example-env",
						context: 128_000,
					},
				],
			},
			item: { label: "env-model", value: "model-env-model" },
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "Environment variable MISSING_MODEL_KEY is not set",
				},
			}),
		});

		expect(result).toEqual({
			step: "auth-error",
			message: "Environment variable MISSING_MODEL_KEY is not set",
		});
	});

	test("model switch selection treats empty apiEnvVar as configured auth", async () => {
		const result = await resolveSwitchModelSelection({
			config: {
				...config,
				models: [
					{
						nickname: "empty-env-model",
						baseUrl: "https://api.empty-env.example.test/v1",
						apiEnvVar: "",
						model: "example-empty-env",
						context: 128_000,
					},
				],
			},
			item: { label: "empty-env-model", value: "model-empty-env-model" },
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "Environment variable  is not set",
				},
			}),
		});

		expect(result).toEqual({
			step: "auth-error",
			message: "Environment variable  is not set",
		});
	});

	test("model switch selection keeps key-file setup for models without configured auth", async () => {
		const model = config.models[0];
		const result = await resolveSwitchModelSelection({
			config,
			item: { label: model.nickname, value: `model-${model.nickname}` },
			readKeyForModel: async () => ({
				ok: false,
				error: {
					type: "missing",
					message: "No API key found for https://api.example.test/v1",
				},
			}),
		});

		expect(result).toEqual({ step: "set-api-key", model });
	});

	test("model switch selection switches when auth resolves", async () => {
		const result = await resolveSwitchModelSelection({
			config,
			item: { label: "one", value: "model-one" },
			readKeyForModel: async () => ({ ok: true, key: "secret" }),
		});

		expect(result).toEqual({ step: "switch", nickname: "one" });
	});
});
