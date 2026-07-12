import { describe, expect, it } from "bun:test";

describe("text input state helpers", () => {
	it("computes plain text edits without dropping pasted whitespace", async () => {
		const { nextPlainTextInputState } = await import(
			"../../src/input/editor/state.ts"
		);

		expect(
			nextPlainTextInputState(
				{
					input: "foo\tbar\n  baz",
					key: {},
					showCursor: true,
					attachedImageCount: 0,
				},
				{ currentValue: ">", previousCursorOffset: 0, cursorPosition: 1 },
			),
		).toEqual({
			value: ">foo\tbar\n  baz",
			cursorPosition: 14,
			removeLastImage: false,
		});
	});

	it("handles empty, prepend, and append text edits without changing whitespace", async () => {
		const { nextPlainTextInputState } = await import(
			"../../src/input/editor/state.ts"
		);

		expect(
			nextPlainTextInputState(
				{ input: "", key: {}, showCursor: true, attachedImageCount: 0 },
				{ currentValue: "keep  ", previousCursorOffset: 0, cursorPosition: 6 },
			),
		).toEqual({
			value: "keep  ",
			cursorPosition: 6,
			removeLastImage: false,
		});
		expect(
			nextPlainTextInputState(
				{ input: "  ", key: {}, showCursor: true, attachedImageCount: 0 },
				{ currentValue: "tail", previousCursorOffset: -4, cursorPosition: 0 },
			),
		).toEqual({
			value: "  tail",
			cursorPosition: 2,
			removeLastImage: false,
		});
		expect(
			nextPlainTextInputState(
				{ input: "  ", key: {}, showCursor: true, attachedImageCount: 0 },
				{ currentValue: "head", previousCursorOffset: 0, cursorPosition: 4 },
			),
		).toEqual({
			value: "head  ",
			cursorPosition: 6,
			removeLastImage: false,
		});
	});

	it("normalizes pasted CRLF and CR line endings to LF", async () => {
		const { nextPlainTextInputState, normalizePastedLineEndings } =
			await import("../../src/input/editor/state.ts");

		expect(normalizePastedLineEndings("one\ntwo")).toBe("one\ntwo");
		expect(normalizePastedLineEndings("one\r\ntwo\rthree")).toBe(
			"one\ntwo\nthree",
		);
		expect(
			nextPlainTextInputState(
				{
					input: "a\r\nb\rc",
					key: {},
					showCursor: true,
					attachedImageCount: 0,
				},
				{ currentValue: ">", previousCursorOffset: 0, cursorPosition: 1 },
			),
		).toEqual({
			value: ">a\nb\nc",
			cursorPosition: 6,
			removeLastImage: false,
		});
	});

	it("keeps image deletion as an explicit edit effect", async () => {
		const { nextPlainTextInputState } = await import(
			"../../src/input/editor/state.ts"
		);

		expect(
			nextPlainTextInputState(
				{
					input: "",
					key: { backspace: true },
					showCursor: true,
					attachedImageCount: 1,
				},
				{ currentValue: "", previousCursorOffset: 0, cursorPosition: 0 },
			),
		).toEqual({
			value: "",
			cursorPosition: 0,
			removeLastImage: true,
		});
	});

	it("treats delete as forward delete without splitting graphemes", async () => {
		const { nextPlainTextInputState } = await import(
			"../../src/input/editor/state.ts"
		);

		expect(
			nextPlainTextInputState(
				{
					input: "",
					key: { delete: true },
					showCursor: true,
					attachedImageCount: 0,
				},
				{ currentValue: "a🙂b", previousCursorOffset: -3, cursorPosition: 1 },
			),
		).toEqual({
			value: "ab",
			cursorPosition: 1,
			removeLastImage: false,
		});

		expect(
			nextPlainTextInputState(
				{
					input: "",
					key: { delete: true },
					showCursor: true,
					attachedImageCount: 1,
				},
				{ currentValue: "", previousCursorOffset: 0, cursorPosition: 0 },
			),
		).toEqual({
			value: "",
			cursorPosition: 0,
			removeLastImage: false,
		});
	});

	it("normalizes stale cursor positions before text edits can split graphemes", async () => {
		const { clampCursorPosition, nextPlainTextInputState } = await import(
			"../../src/input/editor/state.ts"
		);

		expect(clampCursorPosition(2, "a🙂b")).toBe(1);
		expect(clampCursorPosition(2, "éx")).toBe(2);
		expect(clampCursorPosition(1, "éx")).toBe(0);
		expect(
			nextPlainTextInputState(
				{
					input: "",
					key: { delete: true },
					showCursor: true,
					attachedImageCount: 0,
				},
				{ currentValue: "a🙂b", previousCursorOffset: -2, cursorPosition: 2 },
			),
		).toEqual({
			value: "ab",
			cursorPosition: 1,
			removeLastImage: false,
		});
		expect(
			nextPlainTextInputState(
				{ input: "X", key: {}, showCursor: true, attachedImageCount: 0 },
				{ currentValue: "a🙂b", previousCursorOffset: -2, cursorPosition: 2 },
			),
		).toEqual({
			value: "aX🙂b",
			cursorPosition: 2,
			removeLastImage: false,
		});
	});

	it("uses terminal width before layout measurement to avoid an unwrapped first render", async () => {
		const { initialTextInputMeasuredWidth, nextTextInputMeasuredWidth } =
			await import("../../src/input/text.ts");

		expect(initialTextInputMeasuredWidth(96)).toBe(96);
		expect(initialTextInputMeasuredWidth(0)).toBe(80);
		expect(initialTextInputMeasuredWidth(undefined)).toBe(80);
		expect(nextTextInputMeasuredWidth(96, 0)).toBe(96);
		expect(nextTextInputMeasuredWidth(96, 120)).toBe(120);
		expect(nextTextInputMeasuredWidth(96, 5, 96)).toBe(96);
		expect(nextTextInputMeasuredWidth(96, 5, 40)).toBe(40);
		expect(nextTextInputMeasuredWidth(96, 120, 100)).toBe(100);
	});

	it("splits rendered input lines without regex allocation", async () => {
		const { splitRenderedTextLines } = await import("../../src/input/text.ts");

		expect(splitRenderedTextLines("")).toEqual([""]);
		expect(splitRenderedTextLines("one\ntwo")).toEqual(["one", "two"]);
		expect(splitRenderedTextLines("one\r\ntwo\rthree\n")).toEqual([
			"one",
			"two",
			"three",
			"",
		]);
	});

	it("keeps image badge text and widths stable across cache boundary", async () => {
		const { getImageBadgeText, getImageBadgeWidth } = await import(
			"../../src/input/text.ts"
		);

		expect(getImageBadgeText(0)).toBe("⟦ 📎 Image Attachment #1 ⟧");
		expect(getImageBadgeText(63)).toBe("⟦ 📎 Image Attachment #64 ⟧");
		expect(getImageBadgeText(64)).toBe("⟦ 📎 Image Attachment #65 ⟧");
		expect(getImageBadgeWidth(0)).toBeGreaterThan(getImageBadgeText(0).length);
		expect(getImageBadgeWidth(64)).toBeGreaterThan(
			getImageBadgeText(64).length,
		);
	});
});
