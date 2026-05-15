import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat, BASE_IR, fileReadIR } from "../common.ts";
import { isImagePath, loadImageFromPath } from "../../utils/image-utils.ts";
import { result } from "../../result.ts";

function withLineNumbers(content: string): string {
  return content
    .split("\n")
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
}

const read = BASE_IR.declare({
  name: "read",
  description: `
Reads file contents as UTF-8, or loads supported image files (PNG, JPEG, etc.) for visual
inspection. Prefer this to Unix tools like \`cat\`. Text output is prefixed with line numbers in
the form \`N: content\` so you can refer to exact positions; the line-number prefix is NOT part
of the file and must not be included when constructing edit/search strings.
`.trim(),
  ArgumentsSchema: t.subtype({
    filePath: t.str.comment("Path to file to read"),
  }),
});

export default read.withCustomIR({ fileReadIR }).define(async () => ({
  async validate(abortSignal, transport, toolCall) {
    return await attemptUntrackedStat(transport, abortSignal, toolCall.original.arguments.filePath);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;

    if (isImagePath(filePath)) {
      return attempt(`Could not read image ${filePath}`, async () => {
        const resolvedPath = await transport.resolvePath(signal, filePath);
        const image = await loadImageFromPath(resolvedPath);
        await fileTracker.recordFileReadTimestamp(transport, signal, filePath);
        return customIR.fileReadIR({ content: `Image file: ${resolvedPath}`, image });
      });
    }

    return attempt(`No such file ${filePath}`, async () => {
      const content = await fileTracker.read(transport, signal, filePath);
      return customIR.fileReadIR({ content: withLineNumbers(content) });
    });
  },
}));
