import { describe, expect, it } from "bun:test";

function expectPresent<T>(value: T): NonNullable<T> {
	if (value === null || value === undefined) {
		throw new Error("Expected value to be present");
	}
	return value;
}

describe("model setup state helpers", () => {
	it("renders authentication choices for an explicit change-auth route", async () => {
		const React = await import("react");
		const { render } = await import("ink-testing-library");
		const { ModelSetupMissingAuthRoute } = await import(
			"../../src/menu/models/detect-routes"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
		);
		const provider = expectPresent(PROVIDERS.openai);
		const instance = render(
			React.createElement(ModelSetupMissingAuthRoute, {
				config: null,
				dispatch: () => undefined,
				onOverrideDefaultApiKey: async () => undefined,
				stepData: { step: "missing", provider },
			}),
		);
		for (let attempt = 0; attempt < 20; attempt += 1) {
			if ((instance.lastFrame() ?? "").includes("API key")) return;
			await Bun.sleep(5);
		}
		expect(instance.lastFrame()).toContain("API key");
	});

	it("keeps stale step transitions from replacing the current setup state", async () => {
		const { reduceModelSetupStep } = await import(
			"../../src/menu/models/state"
		);
		const { PROVIDERS } = await import(
			"../../src/runtime/models/catalog/main"
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
