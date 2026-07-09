import { describe, expect, it } from "bun:test";
import type { Result } from "../../src/shell/result";
import { isWhitespaceCode } from "../../src/shell/text-characters";
import {
	countLines,
	cutIndex,
	estimateTokens,
	extractTrim,
	fileExtLanguage,
	hasNonWhitespace,
	insertAt,
	LINE_SPLIT_REGEX,
	nonEmptyTrimmedText,
	numWidth,
	trimWhitespace,
	wrapTextWithMapping,
} from "../../src/shell/text-processing";

function expectOk<T, E>(result: Result<T, E>): T {
	if (result.success) return result.data;
	throw new Error(String(result.error));
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
		expect(extractTrim("   ")).toEqual(["   ", "", ""]);
		expect(trimWhitespace(" \t hello \n")).toBe("hello");
		expect(trimWhitespace("\u00a0hello\u00a0")).toBe("hello");
		expect(nonEmptyTrimmedText("hello")).toBe("hello");
		expect(nonEmptyTrimmedText(" \t hello \n")).toBe("hello");
		expect(nonEmptyTrimmedText(" \t\n")).toBeNull();
		expect(extractTrim("\u00a0hello\u00a0")).toEqual([
			"\u00a0",
			"hello",
			"\u00a0",
		]);
		expect(trimWhitespace(" \t\n")).toBe("");
		expect(hasNonWhitespace(" \t\n")).toBe(false);
		expect(hasNonWhitespace(" \t octofwen")).toBe(true);
	});

	it("recognizes JavaScript whitespace code units without allocating strings", () => {
		for (const char of [
			" ",
			"\t",
			"\n",
			"\u00a0",
			"\u1680",
			"\u2000",
			"\u200a",
			"\u2028",
			"\u2029",
			"\u202f",
			"\u205f",
			"\u3000",
			"\ufeff",
		]) {
			expect(isWhitespaceCode(char.charCodeAt(0))).toBe(true);
			expect(hasNonWhitespace(char)).toBe(false);
		}
		expect(isWhitespaceCode("a".charCodeAt(0))).toBe(false);
		expect(isWhitespaceCode("🙂".charCodeAt(0))).toBe(false);
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

	it("returns identity mapping for empty wrapped text", () => {
		const result = wrapTextWithMapping("", 10);

		expect(result.wrapped).toBe("");
		expect(result.originalToWrapped).toEqual([0]);
		expect(result.wrappedToOriginal).toBe(result.originalToWrapped);
	});

	it("wraps text at word boundaries and maps inserted newlines", () => {
		const result = wrapTextWithMapping("hello world", 8);

		expect(result.wrapped).toBe("hello \nworld");
		expect(result.wrappedToOriginal[6]).toBe(-1);
		expect(result.originalToWrapped[6]).toBe(7);
		expect(result.wrappedToOriginal[result.wrapped.length]).toBe(11);
	});

	it("wraps at Unicode whitespace word boundaries without dropping spaces", () => {
		const result = wrapTextWithMapping("ab\u00a0cd", 4);

		expect(result.wrapped).toBe("ab\u00a0\ncd");
		expect(result.wrappedToOriginal[3]).toBe(-1);
		expect(result.originalToWrapped[3]).toBe(4);
	});

	it("does not wrap when text exactly fills the available width", () => {
		const asciiResult = wrapTextWithMapping("abc", 3);
		expect(asciiResult.wrapped).toBe("abc");
		expect(asciiResult.wrappedToOriginal).toBe(asciiResult.originalToWrapped);
		expect(wrapTextWithMapping("a bc", 4).wrapped).toBe("a bc");

		const emojiResult = wrapTextWithMapping("🙂🙂", 4);
		expect(emojiResult.wrapped).toBe("🙂🙂");
		expect(emojiResult.originalToWrapped[4]).toBe(4);
	});

	it("keeps exact-width trailing whitespace wrapping", () => {
		const result = wrapTextWithMapping("abc ", 4);

		expect(result.wrapped).toBe("abc\n ");
		expect(result.wrappedToOriginal[3]).toBe(-1);
		expect(result.originalToWrapped[3]).toBe(4);
	});

	it("preserves existing newlines and switches from first-line width", () => {
		const result = wrapTextWithMapping("abc def\nghi", 6, 4);

		expect(result.wrapped).toBe("abc\n def\nghi");
		expect(result.wrappedToOriginal[3]).toBe(-1);
		expect(result.wrappedToOriginal[7]).toBe(6);
	});

	it("wraps long ASCII words without shifting copy mappings", () => {
		const result = wrapTextWithMapping("abcdef", 3);

		expect(result.wrapped).toBe("abc\ndef");
		expect(result.wrappedToOriginal[3]).toBe(-1);
		expect(result.wrappedToOriginal[4]).toBe(3);
		expect(result.originalToWrapped[3]).toBe(4);
		expect(result.originalToWrapped[6]).toBe(7);
	});

	it("maps CRLF input positions after normalizing rendered newlines", () => {
		const result = wrapTextWithMapping("a\r\nb", 10);

		expect(result.wrapped).toBe("a\nb");
		expect(result.originalToWrapped[0]).toBe(0);
		expect(result.originalToWrapped[1]).toBe(1);
		expect(result.originalToWrapped[2]).toBe(1);
		expect(result.originalToWrapped[3]).toBe(2);
		expect(result.originalToWrapped[4]).toBe(3);
		expect(result.wrappedToOriginal[1]).toBe(1);
		expect(result.wrappedToOriginal[2]).toBe(3);
	});

	it("maps surrogate-pair cursor positions using UTF-16 offsets", () => {
		const result = wrapTextWithMapping("🙂a", 10);

		expect(result.wrapped).toBe("🙂a");
		expect(result.originalToWrapped[0]).toBe(0);
		expect(result.originalToWrapped[2]).toBe(2);
		expect(result.originalToWrapped[3]).toBe(3);
		expect(result.wrappedToOriginal[0]).toBe(0);
		expect(result.wrappedToOriginal[2]).toBe(2);
	});

	it("wraps long surrogate-pair words without splitting code points", () => {
		const result = wrapTextWithMapping("🙂🙂🙂", 3);

		expect(result.wrapped).toBe("🙂\n🙂\n🙂");
		expect(result.originalToWrapped[0]).toBe(0);
		expect(result.originalToWrapped[2]).toBe(3);
		expect(result.originalToWrapped[4]).toBe(6);
	});

	it("wraps long emoji grapheme words without splitting joined clusters", () => {
		const family = "👨‍👩‍👧‍👦";
		const result = wrapTextWithMapping(`${family}${family}`, 3);

		expect(result.wrapped).toBe(`${family}\n${family}`);
		expect(result.wrapped).not.toContain("�");
		expect(result.originalToWrapped[0]).toBe(0);
		expect(result.originalToWrapped[family.length]).toBe(family.length + 1);
	});
});
