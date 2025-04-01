import { t } from "structural";

import { ReadToolSchema, readFile, validateRead } from "./read.ts";
import { ListToolSchema, listDir, validateListDir } from "./list.ts";
import { BashToolSchema, runBashCommand } from "./bash.ts";
import { EditToolSchema, editFile, validateEdit } from "./edit.ts";
import { CreateToolSchema, createFile, validateCreateFile } from "./create.ts";

export { ToolError } from "./common.ts";
export { ReadToolSchema } from "./read.ts";
export { ListToolSchema } from "./list.ts";
export { BashToolSchema } from "./bash.ts";
export { EditToolSchema, DiffEdit, AppendEdit, PrependEdit, AllEdits } from "./edit.ts";
export { CreateToolSchema } from "./create.ts";

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
