import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, BASE_IR, fileMutateIR } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

const ArgumentsSchema = t
  .subtype({
    filePath: t.str.comment("The path to the file"),
    text: t.str.comment("The text to prepend"),
  })
  .comment("Prepends to a file");

const Schema = t.subtype({
  name: t.value("prepend"),
  arguments: ArgumentsSchema,
});

const prepend = BASE_IR.declare({
  name: "prepend",
  ArgumentsSchema,
});

export default prepend.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const edit = toolCall.parsed.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);

    const file = await attemptUntrackedRead(transport, signal, filePath);
    const replaced = runEdit({
      file,
      edit,
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
  await attemptUntrackedRead(transport, signal, args.filePath);
  return result.ok(null);
}

function runEdit({
  file,
  edit,
}: {
  file: string;
  edit: t.GetType<typeof ArgumentsSchema>;
}): string {
  return edit.text + file;
}
