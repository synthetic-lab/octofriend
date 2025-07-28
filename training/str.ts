export function insertAt(str: string, index: number, add: string) {
  return str.slice(0, index) + add + str.slice(index);
}

export function cutIndex(str: string, index: number) {
  return str.slice(0, index) + str.slice(index + 1);
}
