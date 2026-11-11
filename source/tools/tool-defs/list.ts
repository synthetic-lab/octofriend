import { t } from "structural";
import { TOOL_BUILDER } from "../../libocto/tools/tool-def.ts";
import { Transport } from "../../libocto/transport.ts";
import { ok, err } from "../../libocto/result.ts";

const ArgumentsSchema = t.subtype({
  dirPath: t.optional(t.str.comment("Path to the directory")),
});

async function validate(
  signal: AbortSignal,
  transport: Transport,
  args: t.GetType<typeof ArgumentsSchema>,
) {
  const dirpath = args.dirPath || ".";
  const isDir = await transport.isDirectory(signal, dirpath);
  if (!isDir.success) return isDir;
  if (!isDir.data) return err(`${dirpath} is not a directory`);
  return ok(null);
}

export default TOOL_BUILDER.withData<{}>()
  .declare({
    name: "list",
    description:
      "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd",
    ArgumentsSchema,
  })
  .define(async () => ({
    async validate(signal, transport, toolCall) {
      return validate(signal, transport, toolCall.parsed.arguments);
    },
    async run({ signal, transport, toolCall }) {
      const dirpath = toolCall.parsed.arguments.dirPath || transport.cwd;
      const validation = await validate(signal, transport, toolCall.parsed.arguments);
      if (!validation.success) return validation;
      const entries = await transport.readdir(signal, dirpath);
      if (!entries.success) return entries;
      const content = entries.data.map(entry => JSON.stringify(entry)).join("\n");
      return ok({
        type: "output",
        content: [{ type: "text", content }],
      });
    },
  }));
