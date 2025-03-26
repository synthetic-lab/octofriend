import { t } from "structural";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
const execPromise = promisify(exec);

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

export const ALL_TOOLS = [
  ReadToolSchema,
  BashToolSchema,
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
  }
}

async function runBashCommand(command: string) {
  const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() });
  return stdout || stderr;
}

async function readFile(toolCall: t.GetType<typeof ReadToolSchema>) {
  return fs.readFile(toolCall.params.filePath, "utf8");
}
