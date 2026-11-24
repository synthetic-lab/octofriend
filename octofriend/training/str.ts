export function insertAt(str: string, index: number, add: string) {
  if(str.length === index + 1) return str + add;
  if(index === 0) return add + str;
  if(index >= str.length) throw new Error("inserting past end of string");
  return str.slice(0, index) + add + str.slice(index);
}

export function cutIndex(str: string, index: number) {
  if(str.length === index + 1) return str.slice(0, index);
  if(index === 0) return str.slice(1);
  if(index >= str.length) throw new Error("cutting past end of string");
  return str.slice(0, index) + str.slice(index + 1);
}
