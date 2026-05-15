import { t } from "structural";
import { TOOL, attempt, toolOutput } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { ok, err } from "../../result.ts";

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
  if (!isDir) return err(`${dirpath} is not a directory`);
  return ok(null);
}

export default TOOL.declare({
  name: "list",
  description:
    "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd",
  ArgumentsSchema,
}).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.parsed.arguments);
  },
  async run({ signal, transport, toolCall }) {
    const dirpath = toolCall.parsed.arguments.dirPath || transport.cwd;
    const validation = await validate(signal, transport, toolCall.parsed.arguments);
    if (!validation.success) return validation;
    return attempt(`No such directory: ${dirpath}`, async () => {
      const entries = await transport.readdir(signal, dirpath);
      return toolOutput(entries.map(entry => JSON.stringify(entry)).join("\n"));
    });
  },
}));
