import { describe, expect, test } from "bun:test";
import type { Config } from "../../internal/configuration/schemas.ts";
import { filterSettingsItems, Menu } from "../../menu/app_menu/main.tsx";

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
});
