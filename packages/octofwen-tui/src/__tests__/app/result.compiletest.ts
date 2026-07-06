import {
	err,
	type Flattened,
	flatten,
	ok,
	type Result,
} from "../../app/result.ts";

const expectType = <T>(_: T) => undefined;

type DeepResult = Result<Result<Result<number, "inner">, "middle">, "outer">;
type DeepFlattened = Flattened<DeepResult>;

expectType<Result<number, "inner" | "middle" | "outer">>({} as DeepFlattened);

const deepOk: DeepResult = ok(ok(ok(1)));
const flattened = flatten(deepOk);
expectType<Result<number, "inner" | "middle" | "outer">>(flattened);

const methodFlattened = deepOk.flatten();
expectType<Result<number, "inner" | "middle" | "outer">>(methodFlattened);

if (flattened.success) {
	expectType<number>(flattened.data);
} else {
	expectType<"inner" | "middle" | "outer">(flattened.error);
}

const innerError: Result<Result<Result<number, "inner">, never>, never> = ok(
	ok(err("inner")),
);
const flattenedInnerError = flatten(innerError);
expectType<Result<number, "inner">>(flattenedInnerError);

const middleError: Result<Result<Result<number, never>, "middle">, never> = ok(
	err("middle"),
);
const flattenedMiddleError = flatten(middleError);
expectType<Result<number, "middle">>(flattenedMiddleError);

const flattenedOuterError = flatten(err("outer" as const));
expectType<Result<never, "outer">>(flattenedOuterError);

// @ts-expect-error flatten should preserve the final Ok value type.
expectType<Result<string, "inner" | "middle" | "outer">>(flattened);

// @ts-expect-error flatten should preserve every nested Err type.
expectType<Result<number, "inner">>(flattened);

// @ts-expect-error .flatten() should use the same inference as flatten(...).
expectType<Result<string, "inner" | "middle" | "outer">>(methodFlattened);
