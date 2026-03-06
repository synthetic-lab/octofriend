import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat, defineTool } from "../common.ts";
import { isImagePath, loadImageFromPath } from "../../utils/image-utils.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path to file to read"),
});
const Schema = t
  .subtype({
    name: t.value("read"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Reads file contents as UTF-8, or loads supported image files (PNG, JPEG, etc.) for visual inspection. Prefer this to Unix tools like `cat`",
  );

export default defineTool<t.GetType<typeof Schema>>(async () => ({
  Schema,
  ArgumentsSchema,
  async validate(abortSignal, transport, toolCall) {
    await attemptUntrackedStat(transport, abortSignal, toolCall.arguments.filePath);
    return null;
  },
  async run(abortSignal, transport, call) {
    const { filePath } = call.arguments;

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
      const content = await fileTracker.read(transport, abortSignal, filePath);
      return {
        content,
        lines: content.split("\n").length,
      };
    });
  },
}));
