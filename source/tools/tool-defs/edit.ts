import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import {
  ToolError,
  attemptUntrackedRead,
  BASE_IR,
  fileMutateIR,
  parseOriginalFile,
} from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

// Construct the intersection manually, since OpenAI and Anthropic can't handle top-level allOf(...)
const DiffParts = {
  search: t.str.comment(`
    The search string to replace. Must EXACTLY match the text you intend to replace, including
    whitespace, punctuation, etc. Make sure to give a few lines of context above and below so you
    don't accidentally replace a different matching substring in the same file.
  `),
  replace: t.str.comment("The string you want to insert into the file"),
};
export const ArgumentsSchema = t
  .subtype({
    filePath: t.str.comment("The path to the file"),
    ...DiffParts,
  })
  .comment(
    "Applies a search/replace edit to a file. This should be your default tool to edit existing files.",
  );
export const DiffEditSchema = t.subtype(DiffParts);

export const Schema = t.subtype({
  name: t.value("edit"),
  arguments: ArgumentsSchema,
});

export const ParsedSchema = ArgumentsSchema.and(
  t.subtype({
    originalFileContents: t.str,
  }),
);

const edit = BASE_IR.declare({
  name: "edit",
  ArgumentsSchema,
  ParsedSchema,
});

export default edit.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments);
  },
  async parse({ signal, transport, original }) {
    return parseOriginalFile(signal, transport, original);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const diff = toolCall.parsed.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);

    const file = await attemptUntrackedRead(transport, signal, filePath);
    const replaced = runEdit({
      path: filePath,
      file,
      diff,
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
  validateDiff({ file, diff: args, path: args.filePath });
  return result.ok(null);
}

function runEdit({
  path,
  file,
  diff,
}: {
  path: string;
  file: string;
  diff: t.GetType<typeof ArgumentsSchema>;
}): string {
  validateDiff({ path, file, diff });
  return file.replace(diff.search, diff.replace);
}

function validateDiff({
  path,
  file,
  diff,
}: {
  path: string;
  file: string;
  diff: t.GetType<typeof ArgumentsSchema>;
}) {
  if (!file.includes(diff.search)) {
    throw new ToolError(
      `
Could not find search string in file ${path}: ${diff.search}
This is likely an error in your formatting. The search string must EXACTLY match, including
whitespace and punctuation.
`.trim(),
    );
  }
  return null;
}
