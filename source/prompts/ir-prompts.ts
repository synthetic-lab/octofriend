export function toolReject() {
  return `
Tool call was rejected by user. Your tool call did not run. No changes were applied.
`.trim();
}

export function fileMutation(filePath: string) {
  return `${filePath} was updated successfully.`;
}

export function fileRead(content: string, seenPath: boolean) {
  if(seenPath) return "File was successfully read.";
  return content;
}
