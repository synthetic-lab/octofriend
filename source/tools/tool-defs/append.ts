import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import {
  attemptUntrackedRead,
  BASE_IR,
  FILE_OUTDATED_ERROR_MESSAGE,
  fileMutateIR,
} from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  text: t.str.comment("The text to append"),
});

const append = BASE_IR.declare({
  name: "append",
  description: "Appends to a file",
  ArgumentsSchema,
});

export default append.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const validation = await validate(signal, transport, toolCall.parsed.arguments);
    if (!validation.success) return validation;

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
  const canEdit = await fileTracker.canEdit(transport, signal, args.filePath);
  if (!canEdit) return result.err(FILE_OUTDATED_ERROR_MESSAGE);
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
