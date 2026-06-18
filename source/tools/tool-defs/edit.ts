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
import { ok, err } from "../../libocto/result.ts";

// Construct the intersection manually, since OpenAI and Anthropic can't handle top-level allOf(...)
const DiffParts = {
  search: t.str.comment(`
    The search string to replace. Must EXACTLY match the text you intend to replace, including
    whitespace, punctuation, etc. Make sure to give a few lines of context above and below so you
    don't accidentally replace a different matching substring in the same file.
  `),
  replace: t.str.comment("The string you want to insert into the file"),
};
export const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  ...DiffParts,
});
export const DiffEditSchema = t.subtype(DiffParts);

export const ParsedSchema = ArgumentsSchema.and(
  t.subtype({
    originalFileContents: t.str,
  }),
);

const edit = TOOL.declare({
  name: "edit",
  description: `
Applies a search/replace edit to a file. This should be your default tool to edit existing files.
`.trim(),
  ArgumentsSchema,
  ParsedSchema,
});

export default edit.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.parsed.arguments);
  },
  async parse({ signal, transport, original }) {
    return parseOriginalFile(signal, transport, original);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath } = toolCall.parsed.arguments;
    const diff = toolCall.parsed.arguments;
    const validation = await validate(signal, transport, diff);
    if (!validation.success) return validation;

    const file = await attemptUntrackedRead(transport, signal, filePath);
    if (!file.success) return file;
    const replaced = await runEdit({
      transport,
      signal,
      diff,
      path: filePath,
      file: file.data,
    });
    if (!replaced.success) return replaced;
    await fileTracker.write(transport, signal, filePath, replaced.data);
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
  return await validateDiff({
    transport,
    signal,
    file: file.data,
    diff: args,
    path: args.filePath,
  });
}

async function runEdit({
  transport,
  signal,
  path,
  file,
  diff,
}: {
  transport: Transport;
  signal: AbortSignal;
  path: string;
  file: string;
  diff: t.GetType<typeof ArgumentsSchema>;
}) {
  const validation = await validateDiff({ transport, signal, path, file, diff });
  if (!validation.success) return validation;
  return ok(file.replace(diff.search, diff.replace));
}

async function validateDiff({
  transport,
  signal,
  path,
  file,
  diff,
}: {
  transport: Transport;
  signal: AbortSignal;
  path: string;
  file: string;
  diff: t.GetType<typeof ArgumentsSchema>;
}) {
  if (!file.includes(diff.search)) {
    const isOutdated = await fileTracker.isOutdated(transport, signal, path);
    if (isOutdated) return err(FILE_OUTDATED_ERROR_MESSAGE);
    return err(
      `
Could not find search string in file ${path}: ${diff.search}
This is likely an error in your formatting. The search string must EXACTLY match, including
whitespace and punctuation.
`.trim(),
    );
  }
  return ok(null);
}
