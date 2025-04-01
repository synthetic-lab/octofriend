import { t } from "structural";
import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { fileTracker, FileExistsError } from "./file-tracker.ts";

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

export const ListToolSchema = t.subtype({
  name: t.value("list"),
  params: t.optional(t.subtype({
    dirPath: t.optional(t.str.comment("Path to the directory")),
  })),
}).comment(
  "Lists directories. Prefer this to Unix tools like `ls`. If no dirPath is provided, lists the cwd"
);

export const BashToolSchema = t.subtype({
	name: t.value("bash"),
	params: t.subtype({
		cmd: t.str.comment("The command to run"),
    timeout: t.num.comment("A timeout for the command, in milliseconds. Be generous."),
	}),
}).comment(`
  Runs a bash command in the cwd. The bash command is run as a subshell, not connected to a PTY, so
  don't run interactive commands: only run commands that will work headless.

  Do NOT attempt to pipe echo, printf, etc commands to work around this. If it's interactive, either
  figure out a non-interactive variant to run instead, or if that's impossible, as a last resort you
  can ask the user to run the command, explaining that it's interactive.

  Often interactive commands provide flags to run them non-interactively. Prefer those flags.
`);

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

export const CreateToolSchema = t.subtype({
  name: t.value("create"),
  params: t.subtype({
    filePath: t.str.comment("Path where the file should be created"),
    content: t.str.comment("Content to write to the file"),
  }),
}).comment("Creates a new file with the specified content");

export const ALL_TOOLS = [
  ReadToolSchema,
  BashToolSchema,
  EditToolSchema,
  ListToolSchema,
  CreateToolSchema,
] as const;

function unionAll<T extends t.Type<any>>(array: readonly T[]): t.Type<t.GetType<T>> {
  if(array.length === 1) return array[0];
  return array[0].or(unionAll(array.slice(1)));
}
export const ToolCallSchema = unionAll(ALL_TOOLS);
export const SKIP_CONFIRMATION: Array<t.GetType<typeof ToolCallSchema>["name"]> = [
  "read",
  "list",
];

export type ToolResult =
  | { type: "output", content: string }
  | { type: "file-edit", path: string, content: string, sequence: number };

export async function runTool(tool: t.GetType<typeof ToolCallSchema>): Promise<ToolResult> {
  switch(tool.name) {
    case "bash":
      return {
        type: "output",
        content: await runBashCommand(tool.params.cmd, tool.params.timeout),
      };
    case "read":
      return { type: "output", content: await readFile(tool) };
    case "edit": {
      const editResult = await editFile(tool);
      return {
        type: "file-edit",
        path: editResult.path,
        content: editResult.content,
        sequence: editResult.sequence
      };
    }
    case "list":
      return { type: "output", content: await listDir(tool) };
    case "create":
      return { type: "output", content: await createFile(tool) };
  }
}

export async function validateTool(tool: t.GetType<typeof ToolCallSchema>): Promise<null> {
  switch(tool.name) {
    case "bash": return null;
    case "read": return await validateRead(tool);
    case "edit": return await validateEdit(tool);
    case "create": return await validateCreateFile(tool);
    case "list": return await validateListDir(tool);
  }
}

async function runBashCommand(command: string, timeout: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      cwd: process.cwd(),
      shell: "/bin/bash",
      timeout,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new ToolError(
`Command exited with code: ${code}
output: ${output}`));
      }
    });

    child.on('error', (err) => {
      reject(new ToolError(`Command failed: ${err.message}`));
    });
  });
}

async function readFile(toolCall: t.GetType<typeof ReadToolSchema>) {
  return attempt(`No such file ${toolCall.params.filePath}`, async () => {
    return fileTracker.read(toolCall.params.filePath);
  });
}
async function validateRead(toolCall: t.GetType<typeof ReadToolSchema>) {
  await attemptUntrackedStat(toolCall.params.filePath);
  return null;
}

function attemptUntrackedStat(path: string) {
  return attempt(`Could not stat(${path}): does the file exist?`, async () => {
    return await fs.stat(path);
  });
}

async function listDir(toolCall: t.GetType<typeof ListToolSchema>) {
  const dirpath = toolCall?.params?.dirPath || process.cwd();
  await validateListDir(toolCall);
  return attempt(`No such directory: ${dirpath}`, async () => {
    const entries = await fs.readdir(dirpath, {
      withFileTypes: true,
    });
    return entries.map(entry => JSON.stringify(entry)).join("\n");
  });
}
async function validateListDir(toolCall: t.GetType<typeof ListToolSchema>) {
  const dirpath = toolCall?.params?.dirPath || process.cwd();
  const stat = await attemptUntrackedStat(dirpath);
  if(!stat.isDirectory()) throw new ToolError(`${dirpath} is not a directory`);
  return null;
}

let editSequenceCounter = 0;

async function editFile(toolCall: t.GetType<typeof EditToolSchema>) {
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
    path: path.resolve(toolCall.params.filePath),
    content: replaced,
    sequence: editSequenceCounter
  };
}

async function attemptUntrackedRead(path: string) {
  return await attempt(`${path} couldn't be read`, async () => {
    return fs.readFile(path, "utf8");
  });
}

async function validateEdit(toolCall: t.GetType<typeof EditToolSchema>) {
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

async function attempt<T>(errMessage: string, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch {
    throw new ToolError(errMessage);
  }
}

async function createFile(toolCall: t.GetType<typeof CreateToolSchema>) {
  await validateCreateFile(toolCall);
  return attempt(`Failed to create file ${toolCall.params.filePath}`, async () => {
    await fileTracker.write(toolCall.params.filePath, toolCall.params.content);
    return `Successfully created file ${toolCall.params.filePath}`;
  });
}

async function validateCreateFile(toolCall: t.GetType<typeof CreateToolSchema>) {
  try {
    await fileTracker.assertCanCreate(toolCall.params.filePath);
  } catch(e) {
    if(e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return null;
}
