import { describe, expect, it } from "bun:test";
import {
	asynctryexpr,
	err,
	errorToString,
	flatten,
	ok,
	toErrString,
	tryexpr,
} from "../../src/shell/result";

describe("Result constructors and transforms", () => {
	it("maps ok values and leaves errors untouched", () => {
		const result = ok(2).map((value) => value * 3);
		const mappedError = ok(2).mapErr((error) => String(error));

		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(6);
		expect(mappedError.success).toBe(true);
		if (mappedError.success) expect(mappedError.data).toBe(2);
	});

	it("maps err values and leaves ok mapping untouched", () => {
		const result = err("boom").map((value) => String(value));
		const mappedError = err("boom").mapErr((error) => error.toUpperCase());

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toBe("boom");
		expect(mappedError.success).toBe(false);
		if (!mappedError.success) expect(mappedError.error).toBe("BOOM");
	});

	it("chains ok values with andThen and recovers errors with orElse", () => {
		const chained = ok(2).andThen((value) => ok(value + 1));
		const skipped = err("nope").andThen((value) => ok(String(value)));
		const recovered = err("nope").orElse((error) => ok(error.length));
		const kept = ok(2).orElse((error) => ok(String(error)));

		expect(chained.success).toBe(true);
		if (chained.success) expect(chained.data).toBe(3);
		expect(skipped.success).toBe(false);
		if (!skipped.success) expect(skipped.error).toBe("nope");
		expect(recovered.success).toBe(true);
		if (recovered.success) expect(recovered.data).toBe(4);
		expect(kept.success).toBe(true);
		if (kept.success) expect(kept.data).toBe(2);
	});
});

describe("flatten", () => {
	it("leaves a flat ok alone", () => {
		const result = flatten(ok(1));

		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(1);
	});

	it("flattens nested ok results", () => {
		const result = flatten(ok(ok(ok(1))));

		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(1);
	});

	it("flattens nested ok results through the method form", () => {
		const result = ok(ok(ok(1))).flatten();

		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(1);
	});

	it("returns the first inner error reached through ok values", () => {
		const result = flatten(ok(ok(err("inner"))));

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toBe("inner");
	});

	it("returns an outer error without inspecting further", () => {
		const result = flatten(err("outer"));

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toBe("outer");
	});

	it("does not flatten non-result ok data", () => {
		const payload = { success: true, data: "not a Result instance" };
		const result = flatten(ok(payload));

		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(payload);
	});
});

describe("promise", () => {
	it("resolves promised ok data into ok data", async () => {
		const result = await ok(Promise.resolve(1)).promise();

		expect(result.success).toBe(true);
		if (result.success) expect(result.data).toBe(1);
	});

	it("resolves promised err data into err data", async () => {
		const result = await err(Promise.resolve("boom")).promise();

		expect(result.success).toBe(false);
		if (!result.success) expect(result.error).toBe("boom");
	});
});

describe("error conversion", () => {
	it("converts common thrown values to messages", () => {
		expect(errorToString(new Error("error message"))).toBe("error message");
		expect(errorToString("string message")).toBe("string message");
		expect(errorToString({ message: "object message" })).toBe("object message");
		expect(errorToString({ error: "object error" })).toBe("object error");
		expect(errorToString({ reason: "object reason" })).toBe("object reason");
		expect(errorToString({ code: 1 })).toBe(JSON.stringify({ code: 1 }));
		expect(errorToString(7)).toBe("7");
		expect(errorToString(false)).toBe("false");
		expect(errorToString(null)).toBe("null");
		expect(errorToString(undefined)).toBe("undefined");
	});

	it("wraps converted errors in err results", () => {
		const result = toErrString({ message: "object message" });

		expect(result.success).toBe(false);
		expect(result.error).toBe("object message");
	});
});

describe("try expression tuples", () => {
	it("returns sync values as [null, value] and Error throws as [error, null]", () => {
		expect(tryexpr(() => 42)).toEqual([null, 42]);

		const [error, value] = tryexpr(() => decodeURIComponent("%"));

		expect(value).toBeNull();
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toContain("URI");
	});

	it("converts non-Error sync throws into Error instances", () => {
		const [error, value] = tryexpr(() => Function("throw 'string boom'")());

		expect(value).toBeNull();
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toBe("string boom");
	});

	it("returns async values as [null, value] and async throws as [error, null]", async () => {
		await expect(asynctryexpr(() => Promise.resolve(42))).resolves.toEqual([
			null,
			42,
		]);

		const [error, value] = await asynctryexpr(() =>
			Promise.reject(new Error("async boom")),
		);

		expect(value).toBeNull();
		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toBe("async boom");
	});
});
