import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat, ToolDef } from "../common.ts";
import * as path from "path";

const Schema = t.subtype({
 name: t.value("read"),
 params: t.subtype({
   filePath: t.str.comment("Path to file to read"),
 }),
}).comment("Reads file contents as UTF-8. Prefer this to Unix tools like `cat`");

export default {
  Schema, validate,
  async run(call, context) {
    const { filePath } = call.tool.params;
    return attempt(`No such file ${filePath}`, async () => {
      // Actually perform the read to ensure it's readable, and that the timestamps get updated
      await fileTracker.read(filePath)

      // Add it to the context tracker only after the read succeeds, to avoid tracking impossible
      // files
      context.tracker("files").track({
        absolutePath: path.resolve(filePath),
        historyId: call.id,
      });
      return `
Successfully read file ${filePath}. The contents of the file have been placed in your context space.
      `.trim();
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

export async function validate(toolCall: t.GetType<typeof Schema>) {
  await attemptUntrackedStat(toolCall.params.filePath);
  return null;
}
