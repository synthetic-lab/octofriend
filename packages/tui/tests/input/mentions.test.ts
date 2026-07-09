import { describe, expect, it } from "bun:test";

describe("fileSuggestionTrigger", () => {
	it("does not open suggestions for email-style text", async () => {
		const { fileSuggestionTrigger } = await import("../../src/input/text");

		expect(fileSuggestionTrigger("email name@example.com")).toBeNull();
		expect(fileSuggestionTrigger("open @src/app.ts")).toEqual({
			triggerPosition: 5,
			query: "src/app.ts",
		});
		expect(fileSuggestionTrigger("email name@example.com @src")).toEqual({
			triggerPosition: 23,
			query: "src",
		});
		expect(fileSuggestionTrigger("open @src:app.ts")).toBeNull();
	});
});

describe("replaceSelectedMentions", () => {
	it("replaces selected @mentions with normalized relative paths", async () => {
		const { replaceSelectedMentions } = await import("../../src/input/text");

		expect(
			replaceSelectedMentions(
				"open @src/app.ts and @./README.md",
				new Set(["src/app.ts", "./README.md"]),
			),
		).toBe("open ./src/app.ts and ./README.md");
	});

	it("does not replace unselected mentions or email-style text", async () => {
		const { replaceSelectedMentions } = await import("../../src/input/text");

		expect(
			replaceSelectedMentions(
				"keep @src/app.ts and name@example.com",
				new Set(["other.ts"]),
			),
		).toBe("keep @src/app.ts and name@example.com");
	});

	it("skips selected mention work when the input has no mention marker", async () => {
		const { replaceSelectedMentions } = await import("../../src/input/text");

		expect(
			replaceSelectedMentions("plain copied text", new Set(["text"])),
		).toBe("plain copied text");
	});

	it("replaces selected @mentions containing regex syntax as literal paths", async () => {
		const { replaceSelectedMentions } = await import("../../src/input/text");

		expect(
			replaceSelectedMentions(
				"open @src/[id]+(draft).ts and keep @src/[id]+(draft).tsx",
				new Set(["src/[id]+(draft).ts"]),
			),
		).toBe("open ./src/[id]+(draft).ts and keep @src/[id]+(draft).tsx");
	});

	it("replaces repeated selected mentions while preserving email-style text", async () => {
		const { replaceSelectedMentions } = await import("../../src/input/text");

		expect(
			replaceSelectedMentions(
				"mail name@example.com then @example.com and @example.com",
				new Set(["example.com"]),
			),
		).toBe("mail name@example.com then ./example.com and ./example.com");
	});

	it("matches selected mentions by first character bucket without replacing boundary collisions", async () => {
		const { replaceSelectedMentions } = await import("../../src/input/text");

		const selected = new Set([
			"alpha.ts",
			"beta.ts",
			"gamma.ts",
			"gamma.tsx",
			"readme.md",
		]);

		expect(
			replaceSelectedMentions(
				"use @gamma.ts but keep @gamma.tsx-more and email name@readme.md",
				selected,
			),
		).toBe("use ./gamma.ts but keep @gamma.tsx-more and email name@readme.md");
	});
});
