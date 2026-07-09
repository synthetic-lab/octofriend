import { describe, expect, it } from "bun:test";
import {
	DiffApplyFailure,
	DiffApplyResponse,
	DiffApplySuccess,
	fixEditPrompt,
	fixJsonPrompt,
	JsonFixFailure,
	JsonFixResponseSchema,
	JsonFixSuccess,
} from "../../../../src/runtime/prompts/autofix/main";

describe("autofix prompts", () => {
	it("renders a diff edit repair prompt with the broken edit payload and response schemas", () => {
		const prompt = fixEditPrompt({
			file: "const value = 1;",
			edit: {
				search: "const value = 2;",
				replace: "const value = 3;",
			},
		});

		expect(prompt).toContain("The following diff edit is invalid");
		expect(prompt).not.toContain("```");
		expect(prompt).not.toContain("typescript");
		expect(prompt).not.toContain("TypeScript");
		expect(prompt).toContain(
			"Respond only with JSON matching this JSON Schema:",
		);
		expect(prompt).toContain('"anyOf"');
		expect(prompt).toContain('"const": true');
		expect(prompt).toContain('"search"');
		expect(prompt).toContain('"file":"const value = 1;"');
		expect(prompt).toContain('"search":"const value = 2;"');
		expect(prompt).toContain('"replace":"const value = 3;"');
	});

	it("renders a JSON repair prompt and exports parseable response schemas", () => {
		const prompt = fixJsonPrompt('{"name":');

		expect(prompt).toContain("The following string may be broken JSON");
		expect(prompt).not.toContain("```");
		expect(prompt).not.toContain("typescript");
		expect(prompt).not.toContain("TypeScript");
		expect(prompt).toContain("Respond with JSON matching this JSON Schema:");
		expect(prompt).toContain('"anyOf"');
		expect(prompt).toContain('"fixed"');
		expect(prompt).toContain('"const": false');
		expect(prompt).toContain('{"name":');
		expect(
			JsonFixResponseSchema.slice({ success: true, fixed: { name: "Octo" } }),
		).toEqual({ success: true, fixed: { name: "Octo" } });
		expect(JsonFixResponseSchema.slice({ success: false })).toEqual({
			success: false,
		});
		expect(
			DiffApplyResponse.slice({ success: true, search: "needle" }),
		).toEqual({ success: true, search: "needle" });
		expect(DiffApplyResponse.slice({ success: false })).toEqual({
			success: false,
		});
		expect(JsonFixSuccess.slice({ success: true, fixed: null })).toEqual({
			success: true,
			fixed: null,
		});
		expect(JsonFixFailure.slice({ success: false })).toEqual({
			success: false,
		});
		expect(DiffApplySuccess.slice({ success: true, search: "needle" })).toEqual(
			{ success: true, search: "needle" },
		);
		expect(DiffApplyFailure.slice({ success: false })).toEqual({
			success: false,
		});
	});
	it("rejects response schema payloads with missing required fields or extra keys", () => {
		expect(() => JsonFixSuccess.slice({ success: true })).toThrow();
		expect(() =>
			JsonFixFailure.slice({ success: false, fixed: null }),
		).toThrow();
		expect(() => DiffApplySuccess.slice({ success: true })).toThrow();
		expect(() =>
			DiffApplyFailure.slice({ success: false, search: "needle" }),
		).toThrow();
	});
});
