import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, BASE_IR, fileMutateIR } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

const ArgumentsSchema = t
  .subtype({
    filePath: t.str.comment("The path to the file"),
    text: t.str.comment("The text to append"),
  })
  .comment("Appends to a file");

const Schema = t.subtype({
  name: t.value("append"),
  arguments: ArgumentsSchema,
});

const append = BASE_IR.declare({
  name: "append",
  ArgumentsSchema,
});

export default append.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);

    const file = await attemptUntrackedRead(transport, signal, filePath);
    if (!file.success) return file;
    const replaced = runEdit({
      file: file.data,
      edit: toolCall.parsed.arguments,
    });
    await fileTracker.write(transport, signal, filePath, replaced);
    return customIR.fileMutateIR({ content: "" });
  },
}));

async function validate(
  signal: AbortSignal,
  transport: Transport,
  args: t.GetType<typeof ArgumentsSchema>,
) {
  await fileTracker.assertCanEdit(transport, signal, args.filePath);
  const file = await attemptUntrackedRead(transport, signal, args.filePath);
  if (!file.success) return file;
  return result.ok(null);
}

function runEdit({
  file,
  edit,
}: {
  file: string;
  edit: t.GetType<typeof ArgumentsSchema>;
}): string {
  return file + edit.text;
}
