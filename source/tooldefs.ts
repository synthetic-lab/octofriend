import { t } from "structural";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
const execPromise = promisify(exec);

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export const ReadToolSchema = t.subtype({
 name: t.value("read"),
 params: t.subtype({
   filePath: t.str.comment("Path to file to read"),
 }),
}).comment("Reads file contents as UTF-8. Prefer this to Unix tools like `cat`");

export const BashToolSchema = t.subtype({
	name: t.value("bash"),
	params: t.subtype({
		cmd: t.str.comment("The command to run"),
	}),
}).comment("Runs a bash command in the cwd");

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

export const EditToolSchema = t.subtype({
  name: t.value("edit"),
  params: t.subtype({
    filePath: t.str.comment("The path to the file"),
    edit: AllEdits,
  }),
});

export const ALL_TOOLS = [
  ReadToolSchema,
  BashToolSchema,
  EditToolSchema,
] as const;

function unionAll<T extends t.Type<any>>(array: readonly T[]): t.Type<t.GetType<T>> {
  if(array.length === 1) return array[0];
  return array[0].or(unionAll(array.slice(1)));
}
export const ToolCallSchema = unionAll(ALL_TOOLS);

export async function runTool(tool: t.GetType<typeof ToolCallSchema>): Promise<string> {
  switch(tool.name) {
    case "bash": return runBashCommand(tool.params.cmd);
    case "read": return readFile(tool);
    case "edit": return editFile(tool);
  }
}

async function runBashCommand(command: string) {
  const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() });
  return stdout || stderr;
}

async function readFile(toolCall: t.GetType<typeof ReadToolSchema>) {
  return attempt(`No such file ${toolCall.params.filePath}`, async () => {
    return fs.readFile(toolCall.params.filePath, "utf8");
  });
}

async function editFile(toolCall: t.GetType<typeof EditToolSchema>) {
  const file = await attempt(`${toolCall.params.filePath} couldn't be read`, async () => {
    return fs.readFile(toolCall.params.filePath, "utf8");
  });
  const replaced = runEdit({
    path: toolCall.params.filePath,
    file,
    edit: toolCall.params.edit,
  });
  await fs.writeFile(toolCall.params.filePath, replaced, "utf8");
  return `Successfully edited ${toolCall.params.filePath}. File contents are now:\n${replaced}`;
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
  if(!file.includes(diff.search)) {
    throw new ToolError(
      `Could not find search string in file ${path}: ${diff.search}`
    );
  }
  return file.replace(diff.search, diff.replace);
}

async function attempt<T>(errMessage: string, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch {
    throw new ToolError(errMessage);
  }
}
