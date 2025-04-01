import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { ToolResult, attempt, attemptUntrackedStat } from "../common.ts";

export const Schema = t.subtype({
 name: t.value("read"),
 params: t.subtype({
   filePath: t.str.comment("Path to file to read"),
 }),
}).comment("Reads file contents as UTF-8. Prefer this to Unix tools like `cat`");

export async function run(toolCall: t.GetType<typeof Schema>): Promise<ToolResult> {
  return attempt(`No such file ${toolCall.params.filePath}`, async () => {
    return {
      type: "output",
      content: await fileTracker.read(toolCall.params.filePath)
    };
  });
}

export async function validate(toolCall: t.GetType<typeof Schema>) {
  await attemptUntrackedStat(toolCall.params.filePath);
  return null;
}
