export function toolSkip(reason: string) {
  return `
Tool was skipped and didn't run. The reason for skipping the tool was:
${reason}
`.trim();
}

export function imageAttachmentPlaceholderText() {
  return "[An image was attached here. Since images are not supported by your model, the source to the image is omitted. There might be future context that allows you to make a guess about what the image was, so keep that in mind as you process the rest of the messages.]";
}
