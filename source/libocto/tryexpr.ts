export async function asynctryexpr<T>(cb: () => Promise<T>): Promise<[Error, null] | [null, T]> {
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
