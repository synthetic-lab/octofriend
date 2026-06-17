import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, TOOL, fileMutateIR } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { ok } from "../../libocto/result.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  text: t.str.comment("The text to prepend"),
});

const prepend = TOOL.declare({
  name: "prepend",
  description: "Prepends to a file",
  ArgumentsSchema,
});

export default prepend.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.parsed.arguments);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const edit = toolCall.parsed.arguments;
    const validation = await validate(signal, transport, edit);
    if (!validation.success) return validation;

    const file = await attemptUntrackedRead(transport, signal, filePath);
    if (!file.success) return file;
    const replaced = runEdit({
      file: file.data,
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
  const file = await attemptUntrackedRead(transport, signal, args.filePath);
  if (!file.success) return file;
  return ok(null);
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
