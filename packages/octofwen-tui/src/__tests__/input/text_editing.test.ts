import { describe, expect, it } from "bun:test";
import type { Key } from "ink";
import { useEmacsKeyHandler } from "../../input/text.ts";

const key = (overrides: Partial<Key> = {}): Key =>
	({
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		...overrides,
	}) as Key;

describe("useEmacsKeyHandler", () => {
	it("moves to line boundaries with ctrl-a and ctrl-e", () => {
		const handler = useEmacsKeyHandler();

		expect(
			handler.handle("a", key({ ctrl: true }), 4, 9, "octofwen", true),
		).toEqual({
			consumed: true,
			newCursorPosition: 0,
		});
		expect(
			handler.handle("e", key({ ctrl: true }), 4, 9, "octofwen", true),
		).toEqual({
			consumed: true,
			newCursorPosition: 9,
		});
	});

	it("moves by words with meta-b and meta-f", () => {
		const handler = useEmacsKeyHandler();
		const value = "alpha  beta gamma";

		expect(
			handler.handle("b", key({ meta: true }), 12, value.length, value, true),
		).toEqual({
			consumed: true,
			newCursorPosition: 7,
		});
		expect(
			handler.handle("f", key({ meta: true }), 5, value.length, value, true),
		).toEqual({
			consumed: true,
			newCursorPosition: 11,
		});
	});

	it("edits text with ctrl-w, ctrl-h, ctrl-d, meta-d, ctrl-k, and ctrl-u", () => {
		const handler = useEmacsKeyHandler();

		expect(
			handler.handle("w", key({ ctrl: true }), 11, 11, "hello world", true),
		).toEqual({
			consumed: true,
			newCursorPosition: 6,
			newValue: "hello ",
		});
		expect(handler.handle("h", key({ ctrl: true }), 2, 3, "abc", true)).toEqual(
			{
				consumed: true,
				newCursorPosition: 1,
				newValue: "ac",
			},
		);
		expect(handler.handle("d", key({ ctrl: true }), 1, 3, "abc", true)).toEqual(
			{
				consumed: true,
				newValue: "ac",
			},
		);
		expect(
			handler.handle("d", key({ meta: true }), 6, 16, "hello world test", true),
		).toEqual({
			consumed: true,
			newValue: "hello  test",
		});
		expect(
			handler.handle("k", key({ ctrl: true }), 5, 11, "hello world", true),
		).toEqual({
			consumed: true,
			newValue: "hello",
		});
		expect(
			handler.handle("u", key({ ctrl: true }), 6, 11, "hello world", true),
		).toEqual({
			consumed: true,
			newCursorPosition: 0,
			newValue: "world",
		});
	});

	it("does not consume unbound keys", () => {
		const handler = useEmacsKeyHandler();

		expect(handler.handle("x", key(), 0, 0, "", true)).toEqual({
			consumed: false,
		});
	});
});

describe("createVimKeyHandler", () => {
	it("moves in normal mode with h, l, w, b, and line commands", async () => {
		const { createVimKeyHandler } = await import("../../input/text.ts");
		const modeChanges: string[] = [];
		const handler = createVimKeyHandler((mode) => modeChanges.push(mode));
		const value = "alpha beta\n  gamma";

		expect(
			handler.handle("l", key(), 0, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 1,
		});
		expect(
			handler.handle("w", key(), 0, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 6,
		});
		expect(
			handler.handle("b", key(), 8, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 6,
		});
		expect(
			handler.handle("$", key(), 2, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 9,
		});
		expect(
			handler.handle("^", key(), 11, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 13,
		});
		expect(modeChanges).toEqual([]);
	});

	it("edits with x, dd, dw, cw, undo, and redo", async () => {
		const { createVimKeyHandler } = await import("../../input/text.ts");
		const modeChanges: string[] = [];
		const handler = createVimKeyHandler((mode) => modeChanges.push(mode));

		expect(handler.handle("x", key(), 1, 3, "abc", "NORMAL")).toEqual({
			consumed: true,
			newValue: "ac",
			newCursorPosition: 1,
		});
		expect(handler.handle("u", key(), 1, 2, "ac", "NORMAL")).toEqual({
			consumed: true,
			newValue: "abc",
			newCursorPosition: 1,
		});
		expect(
			handler.handle("r", key({ ctrl: true }), 1, 3, "abc", "NORMAL"),
		).toEqual({
			consumed: true,
			newValue: "ac",
			newCursorPosition: 1,
		});

		expect(handler.handle("d", key(), 0, 11, "hello world", "NORMAL")).toEqual({
			consumed: true,
		});
		expect(handler.handle("w", key(), 0, 11, "hello world", "NORMAL")).toEqual({
			consumed: true,
			newValue: "world",
			newCursorPosition: 0,
		});
		expect(handler.handle("d", key(), 0, 11, "hello\nworld", "NORMAL")).toEqual(
			{
				consumed: true,
			},
		);
		expect(handler.handle("d", key(), 0, 11, "hello\nworld", "NORMAL")).toEqual(
			{
				consumed: true,
				newValue: "world",
				newCursorPosition: 0,
			},
		);
		expect(handler.handle("c", key(), 0, 11, "hello world", "NORMAL")).toEqual({
			consumed: true,
		});
		expect(handler.handle("w", key(), 0, 11, "hello world", "NORMAL")).toEqual({
			consumed: true,
			newValue: " world",
			newCursorPosition: 0,
		});
		expect(modeChanges).toContain("INSERT");
	});

	it("handles insert-mode escape and newline insertion", async () => {
		const { createVimKeyHandler } = await import("../../input/text.ts");
		const modeChanges: string[] = [];
		const handler = createVimKeyHandler((mode) => modeChanges.push(mode));

		expect(
			handler.handle("", key({ return: true }), 2, 4, "abcd", "INSERT"),
		).toEqual({
			consumed: true,
			newValue: "ab\ncd",
		});
		expect(
			handler.handle("", key({ escape: true }), 2, 4, "abcd", "INSERT"),
		).toEqual({
			consumed: true,
			newCursorPosition: 1,
		});
		expect(modeChanges).toEqual(["NORMAL"]);
	});
});

describe("computeImageBadgeLayout", () => {
	it("keeps image badges and loading badge on the same row when they fit", async () => {
		const { computeImageBadgeLayout } = await import("../../input/text.ts");

		expect(computeImageBadgeLayout(1, true, 80)).toEqual({
			badgeRows: [
				[
					{ index: 0, isLoading: false },
					{ index: 1, isLoading: true },
				],
			],
			remainingWidthForText: 27,
		});
	});

	it("wraps badges to a new row when the current row is full", async () => {
		const { computeImageBadgeLayout } = await import("../../input/text.ts");

		expect(computeImageBadgeLayout(2, false, 30)).toEqual({
			badgeRows: [
				[{ index: 0, isLoading: false }],
				[{ index: 1, isLoading: false }],
			],
			remainingWidthForText: 3,
		});
	});
});

describe("replaceSelectedMentions", () => {
	it("replaces selected @mentions with normalized relative paths", async () => {
		const { replaceSelectedMentions } = await import("../../input/text.ts");

		expect(
			replaceSelectedMentions(
				"open @src/app.ts and @./README.md",
				new Set(["src/app.ts", "./README.md"]),
			),
		).toBe("open ./src/app.ts and ./README.md");
	});

	it("does not replace unselected mentions or email-style text", async () => {
		const { replaceSelectedMentions } = await import("../../input/text.ts");

		expect(
			replaceSelectedMentions(
				"keep @src/app.ts and name@example.com",
				new Set(["other.ts"]),
			),
		).toBe("keep @src/app.ts and name@example.com");
	});
});

describe("multimedia input helpers", () => {
	it("submits when text is non-empty or images are attached", async () => {
		const { shouldSubmitMultimediaInput } = await import("../../input/text.ts");

		expect(shouldSubmitMultimediaInput(" ask ", [])).toBe(true);
		expect(shouldSubmitMultimediaInput("   ", [{ path: "one.png" }])).toBe(
			true,
		);
		expect(shouldSubmitMultimediaInput("   ", [])).toBe(false);
	});

	it("formats the unsupported image attachment message with the model example", async () => {
		const { getUnsupportedImageAttachmentsMessage } = await import(
			"../../input/text.ts"
		);

		expect(getUnsupportedImageAttachmentsMessage()).toContain(
			"This model does not support image attachments.",
		);
		expect(getUnsupportedImageAttachmentsMessage()).toContain(
			"Switch to a supported model",
		);
	});
});
