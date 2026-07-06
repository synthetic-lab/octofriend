import { describe, expect, it } from "bun:test";
import type { Result } from "../../app/result.ts";
import {
	countLines,
	cutIndex,
	estimateTokens,
	extractTrim,
	fileExtLanguage,
	insertAt,
	LINE_SPLIT_REGEX,
	numWidth,
	wrapTextWithMapping,
} from "../../app/text_processing.ts";

function expectOk<T, E>(result: Result<T, E>): T {
	expect(result.success).toBe(true);
	return result.success ? result.data : undefined as T;
}

describe("text processing", () => {
	it("counts lines and exposes the shared line split regex", () => {
		expect(countLines("one\ntwo\nthree")).toBe(3);
		expect("a\r\nb\rc\n".split(LINE_SPLIT_REGEX)).toEqual(["a", "b", "c", ""]);
	});

	it("formats small string helper results", () => {
		expect(numWidth(12345)).toBe(5);
		expect(fileExtLanguage("src/app.test.tsx")).toBe("tsx");
		expect(fileExtLanguage("README")).toBe("txt");
		expect(extractTrim("  hello world\t")).toEqual(["  ", "hello world", "\t"]);
	});

	it("estimates text tokens with the legacy four-character heuristic", () => {
		expect(estimateTokens("")).toBe(0);
		expect(estimateTokens("a")).toBe(1);
		expect(estimateTokens("abcd")).toBe(1);
		expect(estimateTokens("abcde")).toBe(2);
	});

	it("inserts and cuts strings with legacy boundary semantics", () => {
		expect(expectOk(insertAt("abc", 0, "X"))).toBe("Xabc");
		expect(expectOk(insertAt("abc", 1, "X"))).toBe("aXbc");
		expect(expectOk(insertAt("abc", 2, "X"))).toBe("abcX");

		const insertPastEnd = insertAt("abc", 3, "X");
		expect(insertPastEnd.success).toBe(false);
		if (!insertPastEnd.success) {
			expect(insertPastEnd.error).toBe("inserting past end of string");
		}

		expect(expectOk(cutIndex("abc", 0))).toBe("bc");
		expect(expectOk(cutIndex("abc", 1))).toBe("ac");
		expect(expectOk(cutIndex("abc", 2))).toBe("ab");

		const cutPastEnd = cutIndex("abc", 3);
		expect(cutPastEnd.success).toBe(false);
		if (!cutPastEnd.success) {
			expect(cutPastEnd.error).toBe("cutting past end of string");
		}
	});

	it("wraps text at word boundaries and maps inserted newlines", () => {
		const result = wrapTextWithMapping("hello world", 8);

		expect(result.wrapped).toBe("hello \nworld");
		expect(result.wrappedToOriginal[6]).toBe(-1);
		expect(result.originalToWrapped[6]).toBe(7);
		expect(result.wrappedToOriginal[result.wrapped.length]).toBe(11);
	});

	it("preserves existing newlines and switches from first-line width", () => {
		const result = wrapTextWithMapping("abc def\nghi", 6, 4);

		expect(result.wrapped).toBe("abc\n def\nghi");
		expect(result.wrappedToOriginal[3]).toBe(-1);
		expect(result.wrappedToOriginal[7]).toBe(6);
	});
});
