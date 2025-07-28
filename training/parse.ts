export function parseLines(str: string): string[] {
  if(str.length === 0) return [];

  let line: string[] = [];
  const lines: string[] = [];

  for(const char of str) {
    if(char === "\n") {
      lines.push(line.join(""));
      line = [];
    }
    else {
      line.push(char);
    }
  }

  if(line.length > 0) lines.push(line.join(""));

  return lines;
}
