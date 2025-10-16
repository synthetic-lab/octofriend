import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, ToolDef } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  text: t.str.comment("The text to prepend"),
}).comment("Prepends to a file");

const Schema = t.subtype({
  name: t.value("prepend"),
  arguments: ArgumentsSchema,
});

export default {
  Schema, ArgumentsSchema, validate,
  async run(signal, transport, call) {
    const { filePath } = call.tool.arguments;
    const edit = call.tool.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);

    const file = await attemptUntrackedRead(transport, signal, filePath);
    const replaced = runEdit({
      file, edit,
    });
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

function runEdit({ file, edit }: {
  file: string,
  edit: t.GetType<typeof ArgumentsSchema>,
}): string {
  return edit.text + file;
}
