import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat, defineTool, autoparse, ToolError } from "../common.ts";
import { isImagePath, loadImageFromPath } from "../../utils/image-utils.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to file to read"),
  offset: t.optional(t.num.comment("1-indexed line number to start reading from")),
  limit: t.optional(t.num.comment("Maximum number of lines to read")),
});
const Schema = t
  .subtype({
    name: t.value("read"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Reads file contents as UTF-8, or loads supported image files (PNG, JPEG, etc.) for visual inspection. Prefer this to Unix tools like `cat`. For large text files, use offset and limit to read only the relevant line range while exploring. Text output is prefixed with line numbers in the form `N: content` so you can refer to exact positions; the line-number prefix is NOT part of the file and must not be included when constructing edit/search strings. You must perform a full read of a file before editing it.",
  );

function withLineNumbers(lines: string[], startLine = 1): string {
  return lines.map((line, i) => `${startLine + i}: ${line}`).join("\n");
}

function isPartialRead(args: t.GetType<typeof ArgumentsSchema>): boolean {
  return args.offset !== undefined || args.limit !== undefined;
}

function validateLineRange(args: t.GetType<typeof ArgumentsSchema>) {
  const { offset, limit } = args;
  if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
    throw new ToolError("read offset must be a positive integer");
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new ToolError("read limit must be a positive integer");
  }
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
    content: withLineNumbers(selected, startLine),
  };
}

export default defineTool(Schema, ArgumentsSchema, async () => ({
  Schema,
  ArgumentsSchema,
  async validate(abortSignal, transport, toolCall) {
    validateLineRange(toolCall.arguments);
    if (isPartialRead(toolCall.arguments) && isImagePath(toolCall.arguments.filePath)) {
      throw new ToolError("read offset and limit are only supported for text files");
    }
    await attemptUntrackedStat(transport, abortSignal, toolCall.arguments.filePath);
    return null;
  },
  ...autoparse(ArgumentsSchema),
  async run(abortSignal, transport, call) {
    const args = call.parsed.arguments;
    const { filePath } = args;

    if (isImagePath(filePath)) {
      return attempt(`Could not read image ${filePath}`, async () => {
        const resolvedPath = await transport.resolvePath(abortSignal, filePath);
        const image = await loadImageFromPath(resolvedPath);
        await fileTracker.recordFileReadTimestamp(transport, abortSignal, filePath);
        return {
          content: `Image file: ${resolvedPath}`,
          image,
        };
      });
    }

    return attempt(`No such file ${filePath}`, async () => {
      const hasCurrentFullRead = await fileTracker.canEdit(transport, abortSignal, filePath);
      const shouldReadFullFile = !isPartialRead(args) || hasCurrentFullRead;
      const content = shouldReadFullFile
        ? await fileTracker.read(transport, abortSignal, filePath)
        : await fileTracker.readUntracked(transport, abortSignal, filePath);
      const lines = content.split("\n").length;
      if (shouldReadFullFile) {
        return {
          content: withLineNumbers(content.split("\n")),
          lines,
        };
      }

      const range = lineRange(content, args);
      return {
        content: `Showing lines ${range.startLine}-${range.endLine} of ${range.totalLines} from ${filePath}\n${range.content}`,
        lines,
      };
    });
  },
}));
