import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { ToolError, attempt, ToolResult } from "./common.ts";

export const Schema = t.subtype({
  name: t.value("create"),
  params: t.subtype({
    filePath: t.str.comment("Path where the file should be created"),
    content: t.str.comment("Content to write to the file"),
  }),
}).comment("Creates a new file with the specified content");

export async function run(toolCall: t.GetType<typeof Schema>): Promise<ToolResult> {
  await validate(toolCall);
  return attempt(`Failed to create file ${toolCall.params.filePath}`, async () => {
    await fileTracker.write(toolCall.params.filePath, toolCall.params.content);
    return {
      type: "output",
      content: `Successfully created file ${toolCall.params.filePath}`,
    };
  });
}

export async function validate(toolCall: t.GetType<typeof Schema>) {
  try {
    await fileTracker.assertCanCreate(toolCall.params.filePath);
  } catch(e) {
    if(e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return null;
}
