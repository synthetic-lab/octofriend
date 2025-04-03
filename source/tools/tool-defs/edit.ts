import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { ToolError, attemptUntrackedRead, ToolDef } from "../common.ts";

const DiffEdit = t.subtype({
  type: t.value("diff"),
  search: t.str.comment(`
    The search string to replace. Must EXACTLY match the text you intend to replace, including
    whitespace, punctuation, etc.
  `),
  replace: t.str.comment("The string you want to insert into the file"),
});

const AppendEdit = t.subtype({
  type: t.value("append"),
  text: t.str.comment("The text to append"),
});

const PrependEdit = t.subtype({
  type: t.value("prepend"),
  text: t.str.comment("The text to prepend"),
});

const AllEdits = DiffEdit.or(AppendEdit).or(PrependEdit);

const Schema = t.subtype({
  name: t.value("edit"),
  params: t.subtype({
    filePath: t.str.comment("The path to the file"),
    edit: AllEdits,
  }),
});

export default {
  Schema, validate, AllEdits, PrependEdit, AppendEdit, DiffEdit,
  async run(call, context) {
    const { filePath, edit } = call.tool.params;
    await fileTracker.assertCanEdit(filePath);

    const file = await attemptUntrackedRead(filePath);
    const replaced = runEdit({
      path: filePath,
      file, edit,
    });
    const absolutePath = await fileTracker.write(filePath, replaced);
    context.tracker("files").track({
      absolutePath,
      content: replaced,
      historyId: call.id,
    });

    return `Successfully edited file ${filePath}`;
  },
} satisfies ToolDef<t.GetType<typeof Schema>> & {
  AllEdits: typeof AllEdits,
  PrependEdit: typeof PrependEdit,
  AppendEdit: typeof AppendEdit,
  DiffEdit: typeof DiffEdit,
};

async function validate(toolCall: t.GetType<typeof Schema>) {
  await fileTracker.assertCanEdit(toolCall.params.filePath);
  const file = await attemptUntrackedRead(toolCall.params.filePath);
  switch(toolCall.params.edit.type) {
    case "append": return null;
    case "prepend": return null;
    case "diff":
      return validateDiff({ file, diff: toolCall.params.edit, path: toolCall.params.filePath });
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
    throw new ToolError(`Could not find search string in file ${path}: ${diff.search}`);
  }
  return null;
}
