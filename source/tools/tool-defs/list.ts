import { t } from "structural";
import { BASE_IR, attempt, toolOutput } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

const ArgumentsSchema = t.subtype({
  dirPath: t.optional(t.str.comment("Path to the directory")),
});
const Schema = t
  .subtype({
    name: t.value("list"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd",
  );

async function validate(
  signal: AbortSignal,
  transport: Transport,
  args: t.GetType<typeof ArgumentsSchema>,
) {
  const dirpath = args.dirPath || ".";
  const isDir = await transport.isDirectory(signal, dirpath);
  if (!isDir) return result.err(`${dirpath} is not a directory`);
  return result.ok(null);
}

export default BASE_IR.declare({
  name: "list",
  ArgumentsSchema,
}).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments);
  },
  async run({ signal, transport, toolCall }) {
    const dirpath = toolCall.parsed.arguments.dirPath || transport.cwd;
    const validation = await validate(signal, transport, toolCall.original.arguments);
    if (!validation.success) return validation;
    return attempt(`No such directory: ${dirpath}`, async () => {
      const entries = await transport.readdir(signal, dirpath);
      return toolOutput(entries.map(entry => JSON.stringify(entry)).join("\n"));
    });
  },
}));
