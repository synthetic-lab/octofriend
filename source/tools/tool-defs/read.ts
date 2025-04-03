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
      const content = await fileTracker.read(filePath)
      context.tracker("files").track({
        absolutePath: path.resolve(filePath),
        content,
        historyId: call.id,
      });
      return `Successfully read file ${filePath}`;
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

export async function validate(toolCall: t.GetType<typeof Schema>) {
  await attemptUntrackedStat(toolCall.params.filePath);
  return null;
}
