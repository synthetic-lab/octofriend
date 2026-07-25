export const LINE_NUMBER_PROMPT = `
Text output is prefixed with line numbers in the form \`N: content\` so you can refer to exact
positions; the line-number prefix is NOT part of the file and must not be included when constructing
edit/search strings.
`.trim();

export function withLineNumbers(content: string, startLine = 1): string {
  return content
    .split("\n")
    .map((line, index) => `${startLine + index}: ${line}`)
    .join("\n");
}
