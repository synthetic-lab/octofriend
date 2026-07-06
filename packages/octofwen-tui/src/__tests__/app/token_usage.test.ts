import { describe, expect, it } from "bun:test";
import {
	attachTokenUsageMirror,
	tokenCounts,
	trackTokens,
} from "../../app/token_usage.ts";

describe("token usage tracking", () => {
	it("starts unseen models with zero counts for the opposite token type", () => {
		trackTokens("test-start-model", "input", 3);

		expect(tokenCounts()["test-start-model"]).toEqual({ input: 3, output: 0 });
	});

	it("accumulates input and output token counts by model", () => {
		trackTokens("test-accumulate-model", "input", 2);
		trackTokens("test-accumulate-model", "input", 5);
		trackTokens("test-accumulate-model", "output", 7);

		expect(tokenCounts()["test-accumulate-model"]).toEqual({
			input: 7,
			output: 7,
		});
	});
	it("copies existing counts into an attached shell-owned object", () => {
		trackTokens("test-existing-mirror-model", "input", 9);
		const counts = {};
		const detach = attachTokenUsageMirror(counts);

		expect(counts).toMatchObject({
			"test-existing-mirror-model": { input: 9, output: 0 },
		});
		detach();
	});

	it("mirrors tracked counts into an attached shell-owned object", () => {
		const counts = {};
		const detach = attachTokenUsageMirror(counts);
		trackTokens("test-mirror-model", "input", 4);
		trackTokens("test-mirror-model", "output", 6);

		expect(counts).toMatchObject({
			"test-mirror-model": { input: 4, output: 6 },
		});
		detach();
	});

	it("stops mutating a detached shell-owned object", () => {
		const counts = {};
		const detach = attachTokenUsageMirror(counts);
		detach();
		trackTokens("test-detached-mirror-model", "input", 5);

		expect(counts).not.toHaveProperty("test-detached-mirror-model");
	});
});
