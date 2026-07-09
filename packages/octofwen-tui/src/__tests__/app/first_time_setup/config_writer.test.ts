import { describe, expect, test } from "bun:test";
import { buildFirstTimeConfig } from "../../../app/first_time_setup/config-writer.ts";
import { mergeDefaultApiKeyOverrides } from "../../../internal/configuration/api-key-overrides.ts";

describe("first-time setup config writer", () => {
	test("keeps default API key overrides stable when unchanged", () => {
		const current = { synthetic: "SYNTHETIC_API_KEY" };

		expect(mergeDefaultApiKeyOverrides(undefined, {})).toBeUndefined();
		expect(mergeDefaultApiKeyOverrides(current, {})).toBe(current);
		expect(
			mergeDefaultApiKeyOverrides(current, {
				synthetic: "SYNTHETIC_API_KEY",
			}),
		).toBe(current);
		expect(
			mergeDefaultApiKeyOverrides(undefined, {
				synthetic: "SYNTHETIC_API_KEY",
			}),
		).toEqual({ synthetic: "SYNTHETIC_API_KEY" });
		expect(
			mergeDefaultApiKeyOverrides(current, { synthetic: "CUSTOM_KEY" }),
		).toEqual({ synthetic: "CUSTOM_KEY" });
		expect(
			mergeDefaultApiKeyOverrides(current, { synthetic: "  CUSTOM_KEY  " }),
		).toEqual({ synthetic: "CUSTOM_KEY" });
		expect(
			mergeDefaultApiKeyOverrides(
				{ anthropic: "  ANTHROPIC_API_KEY  ", gemini: "  " },
				{ synthetic: "SYNTHETIC_API_KEY" },
			),
		).toEqual({
			anthropic: "ANTHROPIC_API_KEY",
			synthetic: "SYNTHETIC_API_KEY",
		});
		expect(
			mergeDefaultApiKeyOverrides(undefined, { synthetic: "  " }),
		).toBeUndefined();
	});

	test("ignores inherited API key override properties", () => {
		const current = Object.create({ anthropic: "SHOULD_NOT_COPY" }) as Record<
			string,
			string
		>;
		current.openai = "OPENAI_API_KEY";
		const override = Object.create({ synthetic: "SHOULD_NOT_COPY" }) as Record<
			string,
			string
		>;
		override.openai = "OPENAI_API_KEY";
		override.gemini = "GEMINI_API_KEY";

		expect(mergeDefaultApiKeyOverrides(current, override)).toEqual({
			openai: "OPENAI_API_KEY",
			gemini: "GEMINI_API_KEY",
		});
	});

	test("keeps proto-looking API key override names as data properties", () => {
		const current = { openai: "OPENAI_API_KEY" };
		const override = {} as Record<string, string>;
		Object.defineProperty(override, "__proto__", {
			value: "PROTO_ENV",
			enumerable: true,
		});

		const merged = mergeDefaultApiKeyOverrides(current, override);

		expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
		expect(merged.openai).toBe("OPENAI_API_KEY");
		expect(Object.getOwnPropertyDescriptor(merged, "__proto__")?.value).toBe(
			"PROTO_ENV",
		);
	});

	test("normalizes default API key overrides in first-time config", () => {
		expect(
			buildFirstTimeConfig({
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: {},
			}),
		).toEqual({
			yourName: "Ada",
			models: [],
		});
		const inheritedOnly = Object.create({ openai: "OPENAI_API_KEY" }) as Record<
			string,
			string
		>;
		expect(
			buildFirstTimeConfig({
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: inheritedOnly,
			}),
		).toEqual({
			yourName: "Ada",
			models: [],
		});
		expect(
			buildFirstTimeConfig({
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: { openai: "OPENAI_API_KEY" },
			}),
		).toEqual({
			yourName: "Ada",
			models: [],
			defaultApiKeyOverrides: { openai: "OPENAI_API_KEY" },
		});
		expect(
			buildFirstTimeConfig({
				yourName: "Ada",
				models: [],
				defaultApiKeyOverrides: {
					anthropic: "  ",
					gemini: " GEMINI_API_KEY ",
				},
			}),
		).toEqual({
			yourName: "Ada",
			models: [],
			defaultApiKeyOverrides: { gemini: "GEMINI_API_KEY" },
		});
	});
});
