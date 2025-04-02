import { t } from "structural";
import * as path from "path";
import { fileTracker } from "../file-tracker.ts";
import { ToolError, attemptUntrackedRead, ToolResult } from "../common.ts";

export const DiffEdit = t.subtype({
  type: t.value("diff"),
  search: t.str.comment(`
    The search string to replace. Must EXACTLY match the text you intend to replace, including
    whitespace, punctuation, etc.
  `),
  replace: t.str.comment("The string you want to insert into the file"),
});

export const AppendEdit = t.subtype({
  type: t.value("append"),
  text: t.str.comment("The text to append"),
});

export const PrependEdit = t.subtype({
  type: t.value("prepend"),
  text: t.str.comment("The text to prepend"),
});

export const AllEdits = DiffEdit.or(AppendEdit).or(PrependEdit);

export const Schema = t.subtype({
  name: t.value("edit"),
  params: t.subtype({
    filePath: t.str.comment("The path to the file"),
    edit: AllEdits,
  }),
});

let editSequenceCounter = 0;

export async function run(toolCall: t.GetType<typeof Schema>): Promise<ToolResult> {
  await fileTracker.assertCanEdit(toolCall.params.filePath);

  const file = await attemptUntrackedRead(toolCall.params.filePath);
  const replaced = runEdit({
    path: toolCall.params.filePath,
    file,
    edit: toolCall.params.edit,
  });
  await fileTracker.write(toolCall.params.filePath, replaced);

  editSequenceCounter++;
  return {
    type: "file-edit",
    path: path.resolve(toolCall.params.filePath),
    content: replaced,
    sequence: editSequenceCounter
  };
}

export async function validate(toolCall: t.GetType<typeof Schema>) {
  await fileTracker.assertCanEdit(toolCall.params.filePath);
  const file = await attemptUntrackedRead(toolCall.params.filePath);
  switch(toolCall.params.edit.type) {
    case "append": return null;
    case "prepend": return null;
    case "diff":
      return validateDiff({ file, diff: toolCall.params.edit, path: toolCall.params.filePath });
  }
}

// Mark this tool as hidden from the tool listing
export const hidden = true;

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
