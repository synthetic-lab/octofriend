import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat, ToolDef } from "../common.ts";

const ArgumentsSchema = t.subtype({
   filePath: t.str.comment("Path to file to read"),
});
const Schema = t.subtype({
 name: t.value("read"),
 arguments: ArgumentsSchema,
}).comment("Reads file contents as UTF-8. Prefer this to Unix tools like `cat`. Returns number of lines in file as string.");

export default {
  Schema, ArgumentsSchema,
  async validate(abortSignal, transport, toolCall) {
    await attemptUntrackedStat(transport, abortSignal, toolCall.arguments.filePath);
    return null;
  },
  async run(abortSignal, transport, call) {
    const { filePath } = call.tool.arguments;
    return attempt(`No such file ${filePath}`, async () => {
      // Actually perform the read to ensure it's readable, and that the timestamps get updated
      const content = await fileTracker.read(transport, abortSignal, filePath)
      return content.split("\n").length.toString();
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
