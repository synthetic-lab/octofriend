import { describe, expect, it } from "bun:test";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("model setup state helpers", () => {
	it("keeps stale step transitions from replacing the current setup state", async () => {
		const { reduceModelSetupStep } = await import(
			"../../menu/model_setup/setup-state.ts"
		);
		const { PROVIDERS } = await import(
			"../../internal/model-provider-catalog/main.ts"
		);

		expect(
			reduceModelSetupStep(
				{ step: "missing", provider: { ...expectPresent(PROVIDERS.openai) } },
				{ from: "found", to: { step: "initial" } },
			),
		).toEqual({
			step: "missing",
			provider: { ...expectPresent(PROVIDERS.openai) },
		});
		expect(
			reduceModelSetupStep(
				{ step: "missing", provider: { ...expectPresent(PROVIDERS.openai) } },
				{ force: true, to: { step: "initial" } },
			),
		).toEqual({ step: "initial" });
	});
});
