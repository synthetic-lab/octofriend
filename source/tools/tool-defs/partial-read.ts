import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedStat, TOOL } from "../common.ts";
import { isImagePath } from "../../utils/image-utils.ts";
import { attempt, err } from "../../libocto/result.ts";
import { LINE_NUMBER_PROMPT, withLineNumbers } from "./line-numbers.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to text file to read"),
  offset: t.num.comment("1-indexed line number to start reading from"),
  limit: t.num.comment("Maximum number of lines to read"),
});

type Arguments = t.GetType<typeof ArgumentsSchema>;

function lineRange(content: string, args: Arguments) {
  const allLines = content.split("\n");
  const startIndex = args.offset - 1;
  const selected = allLines.slice(startIndex, startIndex + args.limit);
  const endLine = selected.length === 0 ? args.offset - 1 : args.offset + selected.length - 1;

  return {
    totalLines: allLines.length,
    startLine: args.offset,
    endLine,
    content: selected.length === 0 ? "" : withLineNumbers(selected.join("\n"), args.offset),
  };
}

const partialRead = TOOL.declare({
  name: "partial-read",
  description: `
Reads a range of lines from a UTF-8 text file.

${LINE_NUMBER_PROMPT}

Partial reads only read UTF-8 text: they don't work with images. A partial read does not grant edit
permission. You MUST perform a full read of a file before editing it.
`.trim(),
  ArgumentsSchema,
});

export default partialRead.define(async () => ({
  async validate(signal, transport, toolCall) {
    const args = toolCall.parsed.arguments;
    if (!Number.isInteger(args.offset) || args.offset < 1) {
      return err("partial-read offset must be a positive integer");
    }
    if (!Number.isInteger(args.limit) || args.limit < 1) {
      return err("partial-read limit must be a positive integer");
    }
    if (isImagePath(args.filePath)) {
      return err("partial-read only supports text files");
    }
    return await attemptUntrackedStat(transport, signal, args.filePath);
  },
  async run({ signal, transport, toolCall }) {
    const args = toolCall.parsed.arguments;
    return attempt(`No such file ${args.filePath}`, async () => {
      const content = await fileTracker.readUntracked(transport, signal, args.filePath);
      const range = lineRange(content, args);
      return {
        type: "output" as const,
        content: [
          {
            type: "text" as const,
            content: `Showing lines ${range.startLine}-${range.endLine} of ${range.totalLines} from ${args.filePath}\n${range.content}`,
          },
        ],
        lines: range.totalLines,
      };
    });
  },
}));
