import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedStat, TOOL, fileReadIR } from "../common.ts";
import { isImagePath, loadImageFromPath } from "../../utils/image-utils.ts";
import { attempt, err, ok } from "../../libocto/result.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to file to read"),
  offset: t.optional(t.num.comment("1-indexed line number to start reading from")),
  limit: t.optional(t.num.comment("Maximum number of lines to read")),
});

function withLineNumbers(content: string, startLine = 1): string {
  return content
    .split("\n")
    .map((line, i) => `${startLine + i}: ${line}`)
    .join("\n");
}

function isPartialRead(args: t.GetType<typeof ArgumentsSchema>): boolean {
  return args.offset !== undefined || args.limit !== undefined;
}

function validateLineRange(args: t.GetType<typeof ArgumentsSchema>) {
  const { offset, limit } = args;
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
    return err("read offset must be a positive integer");
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return err("read limit must be a positive integer");
  }
  return ok(null);
}

function lineRange(content: string, args: t.GetType<typeof ArgumentsSchema>) {
  const allLines = content.split("\n");
  const startLine = args.offset ?? 1;
  const startIndex = startLine - 1;
  const endIndex = args.limit === undefined ? allLines.length : startIndex + args.limit;
  const selected = allLines.slice(startIndex, endIndex);
  const endLine = selected.length === 0 ? startLine - 1 : startLine + selected.length - 1;

  return {
    totalLines: allLines.length,
    startLine,
    endLine,
    content: selected.length === 0 ? "" : withLineNumbers(selected.join("\n"), startLine),
  };
}

const read = TOOL.declare({
  name: "read",
  description: `
Reads file contents as UTF-8, or loads supported image files (PNG, JPEG, etc.) for visual
inspection. Prefer this to Unix tools like \`cat\`.

Text output is prefixed with line numbers in
the form \`N: content\` so you can refer to exact positions; the line-number prefix is NOT part
of the file and must not be included when constructing edit/search strings.

Prefer full reads of files unless they're very large (5k+ lines). It's useful for you to have more
context, and you'll waste time chunking when reading small files with offsets. Avoid using offset
or limit unless the file is huge.

You MUST perform a full read of a file before editing it.
`.trim(),
  ArgumentsSchema,
});

export default read.withCustomIR({ fileReadIR }).define(async () => ({
  async validate(abortSignal, transport, toolCall) {
    const args = toolCall.parsed.arguments;
    const lineValidation = validateLineRange(args);
    if (!lineValidation.success) return lineValidation;
    if (isPartialRead(args) && isImagePath(args.filePath)) {
      return err("read offset and limit are only supported for text files");
    }
    return await attemptUntrackedStat(transport, abortSignal, args.filePath);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const args = toolCall.parsed.arguments;
    const { filePath } = args;

    if (isImagePath(filePath)) {
      return attempt(`Could not read image ${filePath}`, async () => {
        const resolvedPath = await transport.resolvePath(signal, filePath);
        const image = await loadImageFromPath(resolvedPath);
        await fileTracker.recordFileReadTimestamp(transport, signal, filePath);
        return customIR.fileReadIR({ content: `Image file: ${resolvedPath}`, image });
      });
    }

    if (isPartialRead(args)) {
      return attempt(`No such file ${filePath}`, async () => {
        const content = await fileTracker.readUntracked(transport, signal, filePath);
        const range = lineRange(content, args);
        return {
          type: "output" as const,
          content: [
            {
              type: "text" as const,
              content: `Showing lines ${range.startLine}-${range.endLine} of ${range.totalLines} from ${filePath}\n${range.content}`,
            },
          ],
          lines: content.split("\n").length,
        };
      });
    }

    return attempt(`No such file ${filePath}`, async () => {
      const content = await fileTracker.read(transport, signal, filePath);
      return customIR.fileReadIR({ content: withLineNumbers(content) });
    });
  },
}));
