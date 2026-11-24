import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedStat } from "../common.ts";
import { fileReadIR } from "../file-ir.ts";
import { TOOL_BUILDER } from "../tool-def.ts";
import { isImagePath, loadImageFromPath } from "../../images.ts";
import { attempt } from "../../result.ts";
import { LINE_NUMBER_PROMPT, withLineNumbers } from "../line-numbers.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to file to read"),
});

const read = TOOL_BUILDER.withData<{}>().declare({
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

export const toolkit = read.withCustomIR({ fileReadIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return await attemptUntrackedStat(transport, signal, toolCall.parsed.arguments.filePath);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;

    if (isImagePath(filePath)) {
      const resolvedPath = await transport.resolvePath(signal, filePath);
      if (!resolvedPath.success) return resolvedPath;
      return attempt(`Could not read image ${filePath}`, async () => {
        const image = await loadImageFromPath(resolvedPath.data);
        const recorded = await fileTracker.recordFileReadTimestamp(transport, signal, filePath);
        if (!recorded.success) return recorded;
        return customIR.fileReadIR({ content: `Image file: ${resolvedPath.data}`, image });
      });
    }

    const content = await fileTracker.read(transport, signal, filePath);
    if (!content.success) return content;
    return customIR.fileReadIR({ content: withLineNumbers(content.data) });
  },
}));
