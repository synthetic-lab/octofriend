import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedStat, TOOL, fileReadIR } from "../common.ts";
import { isImagePath, loadImageFromPath } from "../../utils/image-utils.ts";
import { attempt } from "../../libocto/result.ts";
import { LINE_NUMBER_PROMPT, withLineNumbers } from "./line-numbers.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to file to read"),
});

const read = TOOL.declare({
  name: "read",
  description: `
Reads a UTF-8 file, or loads a supported image file (PNG, JPEG, etc.) for visual
inspection. Prefer this to Unix tools like \`cat\`.

${LINE_NUMBER_PROMPT}

In order to edit a file, you MUST use this tool to perform a full read of the file first at least
once before editing.
`.trim(),
  ArgumentsSchema,
});

export default read.withCustomIR({ fileReadIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return await attemptUntrackedStat(transport, signal, toolCall.parsed.arguments.filePath);
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
