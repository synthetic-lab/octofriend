import { describe, expect, it } from "bun:test";
import {
	attachTokenUsageMirror,
	type TokenUsageCounts,
	tokenCounts,
	trackTokens,
	trackTokenUsage,
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

	it("ignores inherited model keys when resetting an attached mirror", () => {
		trackTokenUsage("test-inherited-mirror-model", 1, 2);
		const counts = Object.create({
			inherited: { input: 99, output: 99 },
		}) as TokenUsageCounts;
		counts.stale = { input: 3, output: 4 };
		const detach = attachTokenUsageMirror(counts);

		expect(Object.hasOwn(counts, "stale")).toBe(false);
		expect(Object.hasOwn(counts, "inherited")).toBe(false);
		expect(counts["test-inherited-mirror-model"]).toEqual({
			input: 1,
			output: 2,
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

	it("tracks input and output tokens with one mirror update", () => {
		const counts: Record<string, { input: number; output: number }> = {};
		const detach = attachTokenUsageMirror(counts);
		trackTokenUsage("test-combined-token-model", 3, 5);

		expect(tokenCounts()["test-combined-token-model"]).toEqual({
			input: 3,
			output: 5,
		});
		expect(counts["test-combined-token-model"]).toEqual({
			input: 3,
			output: 5,
		});
		detach();
	});

	it("updates attached mirror model buckets in place", () => {
		const counts: Record<string, { input: number; output: number }> = {};
		const detach = attachTokenUsageMirror(counts);
		trackTokens("test-stable-mirror-model", "input", 1);
		const firstBucket = counts["test-stable-mirror-model"];
		trackTokens("test-stable-mirror-model", "output", 2);

		expect(counts["test-stable-mirror-model"]).toBe(firstBucket);
		expect(counts["test-stable-mirror-model"]).toEqual({
			input: 1,
			output: 2,
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

	it("keeps proto-looking model names as token data properties", () => {
		const counts: Record<string, { input: number; output: number }> = {};
		const detach = attachTokenUsageMirror(counts);

		trackTokenUsage("__proto__", 2, 3);
		trackTokenUsage("__proto__", 5, 7);

		expect(Object.getPrototypeOf(tokenCounts())).toBeNull();
		expect(
			Object.getOwnPropertyDescriptor(tokenCounts(), "__proto__")?.value,
		).toEqual({ input: 7, output: 10 });
		expect(Object.getPrototypeOf(counts)).toBe(Object.prototype);
		expect(Object.getOwnPropertyDescriptor(counts, "__proto__")?.value).toEqual(
			{
				input: 7,
				output: 10,
			},
		);
		expect(Object.prototype).not.toHaveProperty("input");
		expect(Object.prototype).not.toHaveProperty("output");
		detach();
	});
});
