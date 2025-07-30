import { registry } from "antipattern";

export const deps = registry({
  random() {
    return Math.random();
  },
});

export function pickRandom<T>(arr: Array<T>): T {
  const index = randomIndex(arr);
  return arr[index];
}

export function randomIndex(item: { length: number }) {
  return Math.floor(deps.random() * item.length);
}

export function oneToN(n: number) {
  return Math.ceil(deps.random() * (n - 1)) + 1;
}
export function zeroToN(n: number) {
  return Math.floor(deps.random() * (n + 1));
}
export function percentChance(n: number): boolean {
  return deps.random() < n;
}
export function randomLowercase() {
  return String.fromCharCode(zeroToN(25) + "a".charCodeAt(0));
}
