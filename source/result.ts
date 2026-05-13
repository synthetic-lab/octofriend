export type Result<T, E> = Ok<T> | Err<E>;
export type OkType<R extends Result<any, any>> = R extends Result<infer T, any> ? T : never;
export type ErrType<R extends Result<any, any>> = R extends Result<any, infer E> ? E : never;

export const result = {
  ok<T>(t: T) {
    return new Ok<T>(t);
  },
  err<E>(e: E) {
    return new Err<E>(e);
  },
};

interface IResult<T, E> {
  map<New>(fn: (t: T) => New): Ok<New> | Err<E>;
  mapErr<New>(fn: (e: E) => New): Ok<T> | Err<New>;
  andThen<R extends Result<any, any>>(fn: (t: T) => R): Ok<OkType<R>> | Err<E | ErrType<R>>;
  orElse<R extends Result<any, any>>(fn: (e: E) => R): Ok<T | OkType<R>> | Err<E>;
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
}
