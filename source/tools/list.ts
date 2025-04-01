import { t } from "structural";
import * as fs from "fs/promises";
import { ToolError, attempt, attemptUntrackedStat, ToolResult } from "./common.ts";

export const Schema = t.subtype({
  name: t.value("list"),
  params: t.optional(t.subtype({
    dirPath: t.optional(t.str.comment("Path to the directory")),
  })),
}).comment(
  "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd"
);

export async function run(toolCall: t.GetType<typeof Schema>): Promise<ToolResult> {
  const dirpath = toolCall?.params?.dirPath || process.cwd();
  await validate(toolCall);
  return attempt(`No such directory: ${dirpath}`, async () => {
    const entries = await fs.readdir(dirpath, {
      withFileTypes: true,
    });
    return {
      type: "output",
      content: entries.map(entry => JSON.stringify(entry)).join("\n"),
    };
  });
}

export async function validate(toolCall: t.GetType<typeof Schema>) {
  const dirpath = toolCall?.params?.dirPath || process.cwd();
  const stat = await attemptUntrackedStat(dirpath);
  if(!stat.isDirectory()) throw new ToolError(`${dirpath} is not a directory`);
  return null;
}
