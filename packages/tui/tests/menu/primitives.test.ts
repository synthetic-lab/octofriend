import { describe, expect, it } from "bun:test";

import {
	modelSetupEscapeAction,
	RESET_MODEL_SETUP_TO_INITIAL_ACTION,
} from "../../src/menu/models/state.ts";

describe("model setup primitive routing", () => {
	it("resolves escape-key routing for top-level setup steps", () => {
		expect(modelSetupEscapeAction("initial")).toBe("cancel");
		expect(modelSetupEscapeAction("custom")).toBeNull();
		expect(modelSetupEscapeAction("found")).toBe(
			RESET_MODEL_SETUP_TO_INITIAL_ACTION,
		);
		expect(modelSetupEscapeAction("missing")).toBe(
			RESET_MODEL_SETUP_TO_INITIAL_ACTION,
		);
		expect(modelSetupEscapeAction("override-model-string")).toBe(
			RESET_MODEL_SETUP_TO_INITIAL_ACTION,
		);
	});
});
