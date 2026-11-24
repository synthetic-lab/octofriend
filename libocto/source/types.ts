import { t } from "structural";

export function unionAll<T extends t.Type<any>>(array: readonly T[]): t.Type<t.GetType<T>> {
  if (array.length === 1) return array[0];
  return array[0].or(unionAll(array.slice(1)));
}
