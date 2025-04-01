import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attempt, attemptUntrackedStat } from "./common.ts";

export const ReadToolSchema = t.subtype({
 name: t.value("read"),
 params: t.subtype({
   filePath: t.str.comment("Path to file to read"),
 }),
}).comment("Reads file contents as UTF-8. Prefer this to Unix tools like `cat`");

export async function readFile(toolCall: t.GetType<typeof ReadToolSchema>) {
  return attempt(`No such file ${toolCall.params.filePath}`, async () => {
    return fileTracker.read(toolCall.params.filePath);
  });
}

export async function validateRead(toolCall: t.GetType<typeof ReadToolSchema>) {
  await attemptUntrackedStat(toolCall.params.filePath);
  return null;
}
