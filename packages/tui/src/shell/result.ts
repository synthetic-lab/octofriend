export type Result<T, E> = Ok<T> | Err<E>;
export type OkType<R extends Result<unknown, unknown>> =
	R extends Ok<infer T> ? T : never;
export type ErrType<R extends Result<unknown, unknown>> =
	R extends Err<infer E> ? E : never;

export function ok<T>(t: T) {
	return new Ok<T>(t);
}

export function err<E>(e: E) {
	return new Err<E>(e);
}

export async function attempt<T, E>(
	errMessage: string,
	callback: () => Promise<Result<T, E>>,
): Promise<Result<T, E | string>>;
export async function attempt<T>(
	errMessage: string,
	callback: () => Promise<T>,
): Promise<Result<T, string>>;
export async function attempt<T, E>(
	errMessage: string,
	callback: () => Promise<T | Result<T, E>>,
): Promise<Result<T, E | string>> {
	try {
		const value = await callback();
		if (value instanceof Ok || value instanceof Err) return value;
		return ok(value);
	} catch {
		return err(errMessage);
	}
}

export function toErrString(error: unknown): Err<string> {
	return err(errorToString(error));
}

export function errorToString(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;

	if (typeof error === "object" && error !== null) {
		const errorObj = error as Record<string, unknown>;
		if ("message" in errorObj && typeof errorObj["message"] === "string") {
			return errorObj["message"];
		}
		if ("error" in errorObj && typeof errorObj["error"] === "string") {
			return errorObj["error"];
		}
		if ("reason" in errorObj && typeof errorObj["reason"] === "string") {
			return errorObj["reason"];
		}
		return JSON.stringify(errorObj);
	}

	if (typeof error === "number" || typeof error === "boolean")
		return String(error);

	return String(error);
}

type UnwrapPromise<T, E> =
	| Ok<T extends Promise<infer InnerT> ? InnerT : T>
	| Err<E extends Promise<infer InnerE> ? InnerE : E>;

export type Flattened<R extends Result<unknown, unknown>> = [
	OkType<R>,
] extends [never]
	? Result<never, ErrType<R>>
	: OkType<R> extends Result<unknown, unknown>
		? Flattened<OkType<R>> extends Result<infer InnerT, infer InnerE>
			? Result<InnerT, ErrType<R> | InnerE>
			: never
		: Result<OkType<R>, ErrType<R>>;

export function flatten<R extends Result<unknown, unknown>>(
	r: R,
): Flattened<R> {
	let current: Result<unknown, unknown> = r;

	while (current instanceof Ok && isResult(current.data)) {
		current = current.data;
	}

	return current as Flattened<R>;
}

function isResult(value: unknown): value is Result<unknown, unknown> {
	return value instanceof Ok || value instanceof Err;
}

export class Ok<T> {
	success: true = true;

	readonly data: T;

	constructor(data: T) {
		this.data = data;
	}

	map<New>(fn: (t: T) => New) {
		return new Ok(fn(this.data));
	}

	mapErr<New>(_: (e: never) => New) {
		return this;
	}

	andThen<R extends Result<unknown, unknown>>(fn: (t: T) => R) {
		return fn(this.data);
	}

	orElse<R extends Result<unknown, unknown>>(_: (e: never) => R) {
		return this;
	}

	flatten() {
		return flatten(this);
	}

	async promise() {
		const resolved = await Promise.resolve(this.data);
		return new Ok(resolved) as UnwrapPromise<T, never>;
	}
}

export class Err<E> {
	success: false = false;

	readonly error: E;

	constructor(error: E) {
		this.error = error;
	}

	map<New>(_: (t: never) => New) {
		return this;
	}

	mapErr<New>(fn: (e: E) => New) {
		return new Err(fn(this.error));
	}

	andThen<R extends Result<unknown, unknown>>(_: (t: never) => R) {
		return this;
	}

	orElse<R extends Result<unknown, unknown>>(fn: (e: E) => R) {
		return fn(this.error);
	}

	flatten() {
		return flatten(this);
	}

	async promise() {
		const resolved = await Promise.resolve(this.error);
		return new Err(resolved) as UnwrapPromise<never, E>;
	}
}

export async function asynctryexpr<T>(
	cb: () => Promise<T>,
): Promise<[Error, null] | [null, T]> {
	try {
		const val = await cb();
		return [null, val];
	} catch (e) {
		if (e instanceof Error) return [e, null];
		return [new Error(`${e}`), null];
	}
}

export function tryexpr<T>(cb: () => T): [Error, null] | [null, T] {
	try {
		const val = cb();
		return [null, val];
	} catch (e) {
		if (e instanceof Error) return [e, null];
		return [new Error(`${e}`), null];
	}
}
