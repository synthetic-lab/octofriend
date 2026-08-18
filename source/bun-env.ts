// True when running from a `bun build --compile` binary: build.ts injects
// this constant via Bun.build's `define`, so it's undeclared in dev — hence
// the typeof guard rather than a direct comparison.
declare const OCTO_STANDALONE_EXECUTABLE: string | undefined;

export function isStandaloneExecutable(): boolean {
  return typeof OCTO_STANDALONE_EXECUTABLE !== "undefined";
}
