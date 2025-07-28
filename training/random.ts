export function pickRandom<T>(arr: Array<T>): T {
  const index = randomIndex(arr);
  return arr[index];
}

export function randomIndex(item: { length: number }) {
  return Math.floor(Math.random() * item.length);
}
