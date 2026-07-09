import { describe, expect, it } from "bun:test";

describe("autofix setup route helpers", () => {
	it("builds autofix shortcuts without per-render route data", async () => {
		const { buildAutofixShortcutItems } = await import(
			"../../menu/model_setup/autofix-model-menu.tsx"
		);

		expect(buildAutofixShortcutItems("diff apply")).toEqual([
			{
				type: "key",
				mapping: {
					e: {
						label: "Enable diff apply via Synthetic (recommended)",
						value: "synthetic",
					},
					c: {
						label: "Use a custom diff-apply model...",
						value: "custom",
					},
					b: { label: "Back", value: "back" },
				},
			},
		]);
	});
});
