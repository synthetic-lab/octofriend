import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import {
  attemptUntrackedRead,
  TOOL,
  FILE_OUTDATED_ERROR_MESSAGE,
  fileMutateIR,
  parseOriginalFile,
} from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { ok, err } from "../../result.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  text: t.str.comment("The replaced file contents. This will rewrite and replace the entire file"),
});

const ParsedSchema = ArgumentsSchema.and(
  t.subtype({
    originalFileContents: t.str,
  }),
);

const rewrite = TOOL.declare({
  name: "rewrite",
  description: `
Rewrites the entire file. If you need to rewrite large chunks of the file, or are struggling to
to make a diff edit work, use this as a last resort. Prefer other edit types unless you are
struggling (have failed multiple times in a row).
This overwrites the ENTIRE file, so make sure to write everything you intend to overwrite: you
can't leave anything out by saying e.g. "[The rest of the file stays the same]"
`.trim(),
  ArgumentsSchema,
  ParsedSchema,
});

export default rewrite.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.parsed.arguments);
  },
  async parse({ signal, transport, original }) {
    return parseOriginalFile(signal, transport, original);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const edit = toolCall.parsed.arguments;
    const validation = await validate(signal, transport, edit);
    if (!validation.success) return validation;
    const replaced = runEdit({ edit });
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
  if (!canEdit) return err(FILE_OUTDATED_ERROR_MESSAGE);
  const file = await attemptUntrackedRead(transport, signal, args.filePath);
  if (!file.success) return file;
  return ok(null);
}

function runEdit({ edit }: { edit: t.GetType<typeof ArgumentsSchema> }): string {
  return edit.text;
}
