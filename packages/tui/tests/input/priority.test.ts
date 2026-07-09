import { describe, expect, it } from "bun:test";
import {
	createInputPriorityRegistry,
	FILE_SUGGESTIONS_PRIORITY,
	UNCHAINED_PRIORITY,
} from "../../src/input/priority";

describe("createInputPriorityRegistry", () => {
	it("returns null before any input handlers are registered", () => {
		const registry = createInputPriorityRegistry();

		expect(registry.getActiveId()).toBeNull();
	});

	it("selects the handler with the highest registered priority", () => {
		const registry = createInputPriorityRegistry();

		registry.register(UNCHAINED_PRIORITY, 10);
		registry.register(FILE_SUGGESTIONS_PRIORITY, 20);

		expect(registry.getActiveId()).toBe(20);
	});

	it("falls back to the next registered handler after unregistering the active handler", () => {
		const registry = createInputPriorityRegistry();

		registry.register(UNCHAINED_PRIORITY, 10);
		registry.register(FILE_SUGGESTIONS_PRIORITY, 20);
		registry.unregister(20);

		expect(registry.getActiveId()).toBe(10);
	});

	it("updates the active handler when an existing registration changes priority", () => {
		const registry = createInputPriorityRegistry();

		registry.register(FILE_SUGGESTIONS_PRIORITY, 10);
		registry.register(UNCHAINED_PRIORITY, 20);
		expect(registry.getActiveId()).toBe(10);

		registry.register(-1, 10);
		expect(registry.getActiveId()).toBe(20);
	});
});
