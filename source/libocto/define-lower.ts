import type { IRConversion } from "./llm-ir.ts";

type LoweringResult<T, C extends { role: string }> = IRConversion<
  T,
  Exclude<C, { role: "subagent-trajectory" }>
>;

/**
 * Check that a lowering function cannot produce trajectory IR, retaining its original signature.
 * IR roles must be literal discriminants; custom roles and generic passthroughs are welcome.
 * This is an identity function, not a dispatcher or an iteration/pairing helper.
 */
export function defineLower<F extends (...args: any[]) => any, T, const C extends { role: string }>(
  f: F & ((...args: Parameters<F>) => Array<LoweringResult<T, C>>),
): F {
  return f;
}
