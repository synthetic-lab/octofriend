// Not yet in @types/bun; available at runtime in Bun v1.4+.
export function isStandaloneExecutable(): boolean {
  return (Bun as typeof Bun & { isStandaloneExecutable?: boolean }).isStandaloneExecutable === true;
}
