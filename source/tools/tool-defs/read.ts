import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat, ToolDef } from "../common.ts";

const ArgumentsSchema = t.subtype({
   filePath: t.str.comment("Path to file to read"),
});
const Schema = t.subtype({
 name: t.value("read"),
 arguments: ArgumentsSchema,
}).comment("Reads file contents as UTF-8. Prefer this to Unix tools like `cat`");

export default {
  Schema, ArgumentsSchema, validate,
  async run(_, call) {
    const { filePath } = call.tool.arguments;
    return attempt(`No such file ${filePath}`, async () => {
      // Actually perform the read to ensure it's readable, and that the timestamps get updated
      await fileTracker.read(filePath)
      return "";
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

export async function validate(toolCall: t.GetType<typeof Schema>) {
  await attemptUntrackedStat(toolCall.arguments.filePath);
  return null;
}
