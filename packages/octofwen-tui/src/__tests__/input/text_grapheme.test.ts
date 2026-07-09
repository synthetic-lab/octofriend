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

describe("useEmacsKeyHandler grapheme word editing", () => {
	it("moves by words without landing inside emoji graphemes", () => {
		const handler = useEmacsKeyHandler();
		const value = "a 👩🏽‍💻 b";
		const emojiStart = 2;
		const emojiEnd = 9;
		const nextWordStart = 10;

		expect(
			handler.handle("f", key({ meta: true }), 0, value.length, value, true),
		).toEqual({
			consumed: true,
			newCursorPosition: 1,
		});
		expect(
			handler.handle("f", key({ meta: true }), 1, value.length, value, true),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiEnd,
		});
		expect(
			handler.handle(
				"b",
				key({ meta: true }),
				nextWordStart,
				value.length,
				value,
				true,
			),
		).toEqual({
			consumed: true,
			newCursorPosition: emojiStart,
		});
	});

	it("deletes words without slicing emoji graphemes", () => {
		const handler = useEmacsKeyHandler();
		const value = "a 👩🏽‍💻 b";

		expect(
			handler.handle("d", key({ meta: true }), 2, value.length, value, true),
		).toEqual({
			consumed: true,
			newValue: "a  b",
		});
		expect(
			handler.handle("w", key({ ctrl: true }), 9, value.length, value, true),
		).toEqual({
			consumed: true,
			newCursorPosition: 2,
			newValue: "a  b",
		});
	});
});
