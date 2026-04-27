import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { attemptUntrackedRead, defineTool } from "../common.ts";

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

const ParsedSchema = ArgumentsSchema.and(
  t.subtype({
    originalFileContents: t.str,
  }),
);

export default defineTool(Schema, ParsedSchema, async () => ({
  Schema,
  ArgumentsSchema,
  ParsedSchema,
  async validate(signal, transport, toolCall) {
    await fileTracker.assertCanEdit(transport, signal, toolCall.arguments.filePath);
    await attemptUntrackedRead(transport, signal, toolCall.arguments.filePath);
    return null;
  },
  parse: async (signal, transport, original) => {
    const contents = await attemptUntrackedRead(transport, signal, original.arguments.filePath);
    return {
      success: true,
      data: {
        original,
        parsed: {
          name: original.name,
          arguments: {
            ...original.arguments,
            originalFileContents: contents,
          },
        },
      },
    };
  },
  async run(signal, transport, call) {
    const { filePath } = call.parsed.arguments;
    const edit = call.parsed.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);
    const replaced = runEdit({ edit });
    await fileTracker.write(transport, signal, filePath, replaced);
    return {
      content: "",
    };
  },
}));

function runEdit({ edit }: { edit: t.GetType<typeof ArgumentsSchema> }): string {
  return edit.text;
}
