import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, BASE_IR, fileMutateIR, parseOriginalFile } from "../common.ts";
import { result } from "../../result.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  text: t.str.comment("The replaced file contents. This will rewrite and replace the entire file"),
});

const ParsedSchema = ArgumentsSchema.and(
  t.subtype({
    originalFileContents: t.str,
  }),
);

const rewrite = BASE_IR.declare({
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
    await fileTracker.assertCanEdit(transport, signal, toolCall.original.arguments.filePath);
    const file = await attemptUntrackedRead(
      transport,
      signal,
      toolCall.original.arguments.filePath,
    );
    if (!file.success) return file;
    return result.ok(null);
  },
  async parse({ signal, transport, original }) {
    return parseOriginalFile(signal, transport, original);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const edit = toolCall.parsed.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);
    const replaced = runEdit({ edit });
    await fileTracker.write(transport, signal, filePath, replaced);
    return customIR.fileMutateIR({ content: "" });
  },
}));

function runEdit({ edit }: { edit: t.GetType<typeof ArgumentsSchema> }): string {
  return edit.text;
}
