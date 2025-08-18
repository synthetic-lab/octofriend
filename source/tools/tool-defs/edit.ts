import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { ToolError, attemptUntrackedRead, ToolDef } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

const DiffEdit = t.subtype({
  type: t.value("diff"),
  search: t.str.comment(`
    The search string to replace. Must EXACTLY match the text you intend to replace, including
    whitespace, punctuation, etc. Make sure to give a few lines of context above and below.
  `),
  replace: t.str.comment("The string you want to insert into the file"),
}).comment("Applies a search/replace edit to a file");

const AppendEdit = t.subtype({
  type: t.value("append"),
  text: t.str.comment("The text to append"),
}).comment("Appends to a file");

const PrependEdit = t.subtype({
  type: t.value("prepend"),
  text: t.str.comment("The text to prepend"),
}).comment("Prepends to a file");

const RewriteEdit = t.subtype({
  type: t.value("rewrite-whole"),
  text: t.str.comment("The replaced file contents. This will rewrite and replace the entire file"),
}).comment(`
  Rewrites the entire file. If you need to rewrite large chunks of the file, or are struggling to
  to make a diff edit work, use this as a last resort. Prefer other edit types unless you are
  struggling (have failed multiple times in a row).
  This overwrites the ENTIRE file, so make sure to write everything you intend to overwrite: you
  can't leave anything out by saying e.g. "[The rest of the file stays the same]"
`);

const AllEdits = DiffEdit.or(AppendEdit).or(PrependEdit).or(RewriteEdit);

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("The path to the file"),
  edit: AllEdits,
});

const Schema = t.subtype({
  name: t.value("edit"),
  arguments: ArgumentsSchema,
});

export default {
  Schema, ArgumentsSchema, validate, AllEdits, PrependEdit, AppendEdit, DiffEdit, RewriteEdit,
  async run(signal, transport, call) {
    const { filePath, edit } = call.tool.arguments;
    await fileTracker.assertCanEdit(transport, signal, filePath);

    const file = await attemptUntrackedRead(transport, signal, filePath);
    const replaced = runEdit({
      path: filePath,
      file, edit,
    });
    await fileTracker.write(transport, signal, filePath, replaced);
    return "";
  },
} satisfies ToolDef<t.GetType<typeof Schema>> & {
  AllEdits: typeof AllEdits,
  PrependEdit: typeof PrependEdit,
  AppendEdit: typeof AppendEdit,
  DiffEdit: typeof DiffEdit,
  RewriteEdit: typeof RewriteEdit,
};

async function validate(signal: AbortSignal, transport: Transport, toolCall: t.GetType<typeof Schema>) {
  await fileTracker.assertCanEdit(transport, signal, toolCall.arguments.filePath);
  const file = await attemptUntrackedRead(transport, signal, toolCall.arguments.filePath);
  switch(toolCall.arguments.edit.type) {
    case "append": return null;
    case "prepend": return null;
    case "rewrite-whole": return null;
    case "diff":
      return validateDiff({ file, diff: toolCall.arguments.edit, path: toolCall.arguments.filePath });
  }
}

function runEdit({ path, file, edit }: {
  path: string,
  file: string,
  edit: t.GetType<typeof AllEdits>,
}): string {
  switch(edit.type) {
    case "diff": return diffEditFile({ path, file, diff: edit });
    case "append": return file + edit.text;
    case "prepend": return edit.text + file;
    case "rewrite-whole": return edit.text;
  }
}

function diffEditFile({ path, file, diff }: {
  path: string,
  file: string,
  diff: t.GetType<typeof DiffEdit>,
}): string {
  validateDiff({ path, file, diff });
  return file.replace(diff.search, diff.replace);
}

function validateDiff({ path, file, diff }: {
  path: string,
  file: string,
  diff: t.GetType<typeof DiffEdit>,
}) {
  if(!file.includes(diff.search)) {
    throw new ToolError(`
Could not find search string in file ${path}: ${diff.search}
This is likely an error in your formatting. The search string must EXACTLY match, including
whitespace and punctuation.
`.trim());
  }
  return null;
}
