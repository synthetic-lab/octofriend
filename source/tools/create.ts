import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { ToolError, attempt } from "./common.ts";

export const CreateToolSchema = t.subtype({
  name: t.value("create"),
  params: t.subtype({
    filePath: t.str.comment("Path where the file should be created"),
    content: t.str.comment("Content to write to the file"),
  }),
}).comment("Creates a new file with the specified content");

export async function createFile(toolCall: t.GetType<typeof CreateToolSchema>) {
  await validateCreateFile(toolCall);
  return attempt(`Failed to create file ${toolCall.params.filePath}`, async () => {
    await fileTracker.write(toolCall.params.filePath, toolCall.params.content);
    return `Successfully created file ${toolCall.params.filePath}`;
  });
}

export async function validateCreateFile(toolCall: t.GetType<typeof CreateToolSchema>) {
  try {
    await fileTracker.assertCanCreate(toolCall.params.filePath);
  } catch(e) {
    if(e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return null;
}
