export type Result<T, E> = Ok<T> | Err<E>;
export type OkType<R extends Result<any, any>> = R extends Ok<infer T> ? T : never;
export type ErrType<R extends Result<any, any>> = R extends Err<infer E> ? E : never;

export function ok<T>(t: T) {
  return new Ok<T>(t);
}

export function err<E>(e: E) {
  return new Err<E>(e);
}

export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) return result.data;
  throw new Error(errorToString(result.error));
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
    // Try to extract message from error object
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
    // Fallback: stringify the object
    return JSON.stringify(errorObj);
  }

  if (typeof error === "number" || typeof error === "boolean") return String(error);

  // Fallback for null/undefined/everything else
  return String(error);
}

type UnwrapPromise<T, E> =
  | Ok<T extends Promise<infer InnerT> ? InnerT : T>
  | Err<E extends Promise<infer InnerE> ? InnerE : E>;

interface IResult<T, E> {
  map<New>(fn: (t: T) => New): Ok<New> | Err<E>;
  mapErr<New>(fn: (e: E) => New): Ok<T> | Err<New>;
  andThen<R extends Result<any, any>>(fn: (t: T) => R): Ok<OkType<R>> | Err<E | ErrType<R>>;
  orElse<R extends Result<any, any>>(fn: (e: E) => R): Ok<T | OkType<R>> | Err<E>;
  flatten(): Flattened<Result<T, E>>;
  promise(): Promise<UnwrapPromise<T, E>>;
}

export type Flattened<R extends Result<any, any>> = [OkType<R>] extends [never]
  ? Result<never, ErrType<R>>
  : OkType<R> extends Result<any, any>
    ? Flattened<OkType<R>> extends Result<infer InnerT, infer InnerE>
      ? Result<InnerT, ErrType<R> | InnerE>
      : never
    : Result<OkType<R>, ErrType<R>>;

export function flatten<R extends Result<any, any>>(r: R): Flattened<R> {
  let current: Result<any, any> = r;

  while (current instanceof Ok && isResult(current.data)) {
    current = current.data;
  }

  return current as Flattened<R>;
}

function isResult(value: unknown): value is Result<any, any> {
  return value instanceof Ok || value instanceof Err;
}

export class Ok<T> implements IResult<T, any> {
  success: true = true;
  constructor(readonly data: T) {}

  map<New>(fn: (t: T) => New) {
    return new Ok(fn(this.data));
  }
  mapErr<New>(_: (e: any) => New) {
    return this;
  }
  andThen<R extends Result<any, any>>(fn: (t: T) => R) {
    return fn(this.data);
  }
  orElse<R extends Result<any, any>>(_: (e: any) => R) {
    return this;
  }
  flatten() {
    return flatten(this);
  }
  async promise() {
    const resolved = await Promise.resolve(this.data);
    return new Ok(resolved) as UnwrapPromise<T, any>;
  }
}

export class Err<E> implements IResult<any, E> {
  success: false = false;
  constructor(readonly error: E) {}

  map<New>(_: (t: any) => New) {
    return this;
  }
  mapErr<New>(fn: (e: E) => New) {
    return new Err(fn(this.error));
  }
  andThen<R extends Result<any, any>>(_: (t: any) => R) {
    return this;
  }
  orElse<R extends Result<any, any>>(fn: (e: E) => R) {
    return fn(this.error);
  }
  flatten() {
    return flatten(this);
  }
  async promise() {
    const resolved = await Promise.resolve(this.error);
    return new Err(resolved) as UnwrapPromise<any, E>;
  }
}
