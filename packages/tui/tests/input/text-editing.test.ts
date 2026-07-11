import { describe, expect, it } from "bun:test";
import type { Key } from "ink";
import { useEmacsKeyHandler } from "../../src/input/text.ts";

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
			handler.handle("a", key({ ctrl: true }), 4, 9, "octofriend", true),
		).toEqual({
			consumed: true,
			newCursorPosition: 0,
		});
		expect(
			handler.handle("e", key({ ctrl: true }), 4, 9, "octofriend", true),
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

	it("moves by words across graphemes and non-breaking spaces", () => {
		const handler = useEmacsKeyHandler();
		const value = "a👩🏽‍💻\u00a0beta";
		const betaStart = 9;

		expect(
			handler.handle("f", key({ meta: true }), 0, value.length, value, true),
		).toEqual({
			consumed: true,
			newCursorPosition: betaStart - 1,
		});
		expect(
			handler.handle(
				"f",
				key({ meta: true }),
				betaStart - 1,
				value.length,
				value,
				true,
			),
		).toEqual({
			consumed: true,
			newCursorPosition: value.length,
		});
		expect(
			handler.handle(
				"b",
				key({ meta: true }),
				betaStart,
				value.length,
				value,
				true,
			),
		).toEqual({
			consumed: true,
			newCursorPosition: 0,
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
	it("computes line navigation without allocating split arrays", async () => {
		const {
			getLineCount,
			getLineEnd,
			getFirstNonWhitespacePosition,
			getLineInfo,
			getLineRange,
			getLineStart,
			getLineText,
			hasLineAfter,
			isWhitespace,
			isWordChar,
		} = await import("../../src/input/editor/vim-nav.ts");

		const value = "alpha\n  beta\n";
		expect(getLineInfo(value, 0)).toEqual({ lineIndex: 0, columnIndex: 0 });
		expect(getLineInfo(value, 5)).toEqual({ lineIndex: 0, columnIndex: 5 });
		expect(getLineInfo(value, 6)).toEqual({ lineIndex: 1, columnIndex: 0 });
		expect(getLineStart(value, 1)).toBe(6);
		expect(getLineStart(value, 3)).toBe(value.length + 1);
		expect(getLineEnd(value, 1)).toBe(11);
		expect(getLineText(value, 1)).toBe("  beta");
		expect(getLineRange(value, 1)).toEqual({ start: 0, end: 6 });
		expect(hasLineAfter(value, 1)).toBe(true);
		expect(hasLineAfter(value, 2)).toBe(false);
		expect(getLineCount(value)).toBe(3);
		expect(getFirstNonWhitespacePosition("\u00a0\talpha", 0)).toBe(2);
		expect(isWhitespace("\u00a0")).toBe(true);
		expect(isWordChar("_")).toBe(true);
		expect(isWordChar("-")).toBe(false);
	});

	it("treats CRLF as one newline for vim line navigation", async () => {
		const {
			getLineCount,
			getLineEnd,
			getLineInfo,
			getLineRange,
			getLineStart,
			getLineText,
			hasLineAfter,
			trimNewlinesFromEnd,
		} = await import("../../src/input/editor/vim-nav.ts");

		const value = "alpha\r\n  beta\r\ngamma";
		expect(getLineInfo(value, 0)).toEqual({ lineIndex: 0, columnIndex: 0 });
		expect(getLineInfo(value, 5)).toEqual({ lineIndex: 0, columnIndex: 5 });
		expect(getLineInfo(value, 7)).toEqual({ lineIndex: 1, columnIndex: 0 });
		expect(getLineStart(value, 1)).toBe(7);
		expect(getLineEnd(value, 0)).toBe(4);
		expect(getLineText(value, 0)).toBe("alpha");
		expect(getLineText(value, 1)).toBe("  beta");
		expect(getLineRange(value, 1)).toEqual({ start: 0, end: 7 });
		expect(hasLineAfter(value, 1)).toBe(true);
		expect(getLineCount(value)).toBe(3);
		expect(trimNewlinesFromEnd("alpha\r\n", 0, "alpha\r\n".length)).toBe(5);
	});

	it("moves in normal mode with h, l, w, b, and line commands", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
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

	it("keeps vim normal cursor off CRLF separator bytes", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
		const handler = createVimKeyHandler(() => undefined);
		const value = "alpha\r\nbeta";

		expect(
			handler.handle("$", key(), 0, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 4,
		});
		expect(
			handler.handle("j", key(), 2, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 9,
		});
		expect(
			handler.handle("k", key(), 9, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: 2,
		});
		expect(
			handler.handle("D", key(), 2, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newValue: "al\r\nbeta",
			newCursorPosition: 1,
		});
	});

	it("moves and deletes full graphemes in vim normal mode", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
		const handler = createVimKeyHandler(() => undefined);
		const value = "a👩🏽‍💻b";
		const emojiStart = 1;
		const emojiEnd = value.length - 1;

		expect(
			handler.handle("l", key(), 0, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiStart,
		});
		expect(
			handler.handle("l", key(), emojiStart, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiEnd,
		});
		expect(
			handler.handle("h", key(), emojiEnd, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiStart,
		});
		expect(
			handler.handle("x", key(), emojiStart, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newValue: "ab",
			newCursorPosition: 1,
		});
	});

	it("keeps vim word motions on grapheme boundaries", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
		const handler = createVimKeyHandler(() => undefined);
		const value = "a 👩🏽‍💻 b";
		const emojiStart = 2;
		const nextWordStart = 10;

		expect(
			handler.handle("w", key(), 0, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiStart,
		});
		expect(
			handler.handle("w", key(), emojiStart, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: nextWordStart,
		});
		expect(
			handler.handle("b", key(), nextWordStart, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiStart,
		});
		expect(
			handler.handle("B", key(), nextWordStart, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiStart,
		});
		expect(
			handler.handle("e", key(), emojiStart, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: nextWordStart,
		});
	});

	it("treats non-breaking spaces as whitespace in vim word motions", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
		const handler = createVimKeyHandler(() => undefined);
		const value = "foo\u00a0bar";
		const secondWordStart = 4;

		expect(
			handler.handle("w", key(), 0, value.length, value, "NORMAL"),
		).toEqual({
			consumed: true,
			newCursorPosition: secondWordStart,
		});
		expect(
			handler.handle(
				"b",
				key(),
				secondWordStart,
				value.length,
				value,
				"NORMAL",
			),
		).toEqual({
			consumed: true,
			newCursorPosition: 0,
		});
	});

	it("edits with x, dd, dw, cw, undo, and redo", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
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

	it("clears redo history after saving a new vim edit", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
		const handler = createVimKeyHandler(() => undefined);

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
		expect(handler.handle("x", key(), 0, 3, "abc", "NORMAL")).toEqual({
			consumed: true,
			newValue: "bc",
			newCursorPosition: 0,
		});
		expect(
			handler.handle("r", key({ ctrl: true }), 0, 2, "bc", "NORMAL"),
		).toEqual({
			consumed: true,
		});
	});

	it("leaves insert mode on a grapheme boundary", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
		const modeChanges: string[] = [];
		const handler = createVimKeyHandler((mode) => modeChanges.push(mode));
		const value = "a👩🏽‍💻";

		expect(
			handler.handle(
				"",
				key({ escape: true }),
				value.length,
				value.length,
				value,
				"INSERT",
			),
		).toEqual({
			consumed: true,
			newCursorPosition: 1,
		});
		expect(modeChanges).toEqual(["NORMAL"]);
	});

	it("handles insert-mode escape and newline insertion", async () => {
		const { createVimKeyHandler } = await import("../../src/input/text.ts");
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
		const { computeImageBadgeLayout } = await import("../../src/input/text.ts");

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
		const { computeImageBadgeLayout } = await import("../../src/input/text.ts");

		expect(computeImageBadgeLayout(2, false, 30)).toEqual({
			badgeRows: [
				[{ index: 0, isLoading: false }],
				[{ index: 1, isLoading: false }],
			],
			remainingWidthForText: 3,
		});
	});
});

describe("multimedia input helpers", () => {
	it("submits when text is non-empty or images are attached", async () => {
		const { shouldSubmitMultimediaInput } = await import(
			"../../src/input/text.ts"
		);

		expect(shouldSubmitMultimediaInput(" ask ", [])).toBe(true);
		expect(shouldSubmitMultimediaInput("   ", [{ path: "one.png" }])).toBe(
			true,
		);
		expect(shouldSubmitMultimediaInput("   ", [])).toBe(false);
	});

	it("formats the unsupported image attachment message with the model example", async () => {
		const { getUnsupportedImageAttachmentsMessage } = await import(
			"../../src/input/text.ts"
		);

		expect(getUnsupportedImageAttachmentsMessage()).toContain(
			"This model does not support image attachments.",
		);
		expect(getUnsupportedImageAttachmentsMessage()).toContain(
			"Switch to a supported model",
		);
	});
});
