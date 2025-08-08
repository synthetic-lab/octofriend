import { t } from "structural";
import * as fs from "fs/promises";
import { ToolError, attempt, attemptUntrackedStat, ToolDef } from "../common.ts";

const ArgumentsSchema = t.subtype({
  dirPath: t.optional(t.str.comment("Path to the directory")),
});
const Schema = t.subtype({
  name: t.value("list"),
  arguments: t.optional(ArgumentsSchema),
}).comment(
  "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd"
);

export default {
  Schema, ArgumentsSchema, validate,
  async run(_, call) {
    const dirpath = call.tool.arguments?.dirPath || process.cwd();
    await validate(call.tool);
    return attempt(`No such directory: ${dirpath}`, async () => {
      const entries = await fs.readdir(dirpath, {
        withFileTypes: true,
      });
      return entries.map(entry => JSON.stringify(entry)).join("\n");
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

async function validate(toolCall: t.GetType<typeof Schema>) {
  const dirpath = toolCall?.arguments?.dirPath || process.cwd();
  const stat = await attemptUntrackedStat(dirpath);
  if(!stat.isDirectory()) throw new ToolError(`${dirpath} is not a directory`);
  return null;
}
