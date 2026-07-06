import { describe, expect, test } from "bun:test";
import {
	PreflightAutofixAuth,
	PreflightModelAuth,
	resolveAutofixModelFromConfig,
	resolveModelFromConfig,
} from "../../app/auth_preflight/main.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";

const config: Config = {
	configVersion: 2,
	yourName: "Test User",
	models: [
		{
			nickname: "Primary",
			baseUrl: "https://example.invalid/v1",
			model: "primary-model",
			context: 1000,
		},
		{
			nickname: "Fallback",
			baseUrl: "https://fallback.invalid/v1",
			model: "fallback-model",
			context: 2000,
		},
	],
	diffApply: {
		baseUrl: "https://diff.invalid/v1",
		model: "diff-model",
	},
};

describe("terminal auth preflight", () => {
	test("exports preflight auth components", () => {
		expect(PreflightModelAuth).toBeFunction();
		expect(PreflightAutofixAuth).toBeFunction();
	});

	test("resolves a reloaded model by nickname and base URL before falling back to base URL", () => {
		expect(
			resolveModelFromConfig(config, {
				nickname: "Primary",
				baseUrl: "https://example.invalid/v1",
				model: "stale-model",
				context: 1,
			}),
		).toBe(config.models[0]);

		expect(
			resolveModelFromConfig(config, {
				nickname: "Changed",
				baseUrl: "https://fallback.invalid/v1",
				model: "stale-model",
				context: 1,
			}),
		).toBe(config.models[1]);
	});

	test("resolves an autofix model from the reloaded matching config entry", () => {
		const diffApply = config.diffApply;
		if (!diffApply) throw new Error("diffApply fixture must be defined");

		expect(
			resolveAutofixModelFromConfig(
				config,
				{
					baseUrl: "https://diff.invalid/v1",
					model: "stale-diff-model",
				},
				"diffApply",
			),
		).toBe(diffApply);
	});
});
