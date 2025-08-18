import { t } from "structural";
import { ToolError, attempt, ToolDef } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

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
  async run(abortSignal, transport, call) {
    const dirpath = call.tool.arguments?.dirPath || process.cwd();
    await validate(abortSignal, transport, call.tool);
    return attempt(`No such directory: ${dirpath}`, async () => {
      const entries = await transport.readdir(abortSignal, dirpath);
      return entries.map(entry => JSON.stringify(entry)).join("\n");
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

async function validate(signal: AbortSignal, transport: Transport, toolCall: t.GetType<typeof Schema>) {
  const dirpath = toolCall?.arguments?.dirPath || ".";
  const isDir = await transport.isDirectory(signal, dirpath);
  if(!isDir) throw new ToolError(`${dirpath} is not a directory`);
  return null;
}
