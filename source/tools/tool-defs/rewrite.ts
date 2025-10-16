import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, ToolDef } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  text: t.str.comment("The replaced file contents. This will rewrite and replace the entire file"),
}).comment(`
  Rewrites the entire file. If you need to rewrite large chunks of the file, or are struggling to
  to make a diff edit work, use this as a last resort. Prefer other edit types unless you are
  struggling (have failed multiple times in a row).
  This overwrites the ENTIRE file, so make sure to write everything you intend to overwrite: you
  can't leave anything out by saying e.g. "[The rest of the file stays the same]"
`);

const Schema = t.subtype({
  name: t.value("rewrite"),
  arguments: ArgumentsSchema,
});

export default {
  Schema, ArgumentsSchema, validate,
  async run(signal, transport, call) {
    const { filePath } = call.tool.arguments;
    const edit = call.tool.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);
    const replaced = runEdit({ edit });
    await fileTracker.write(transport, signal, filePath, replaced);
    return {
      content: "",
    };
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;

async function validate(signal: AbortSignal, transport: Transport, toolCall: t.GetType<typeof Schema>) {
  await fileTracker.assertCanEdit(transport, signal, toolCall.arguments.filePath);
  await attemptUntrackedRead(transport, signal, toolCall.arguments.filePath);
  return null;
}

function runEdit({ edit }: {
  edit: t.GetType<typeof ArgumentsSchema>,
}): string {
  return edit.text;
}
