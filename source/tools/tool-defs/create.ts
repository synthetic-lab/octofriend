import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { ToolError, attempt, ToolDef } from "../common.ts";

const Schema = t.subtype({
  name: t.value("create"),
  params: t.subtype({
    filePath: t.str.comment("Path where the file should be created"),
    content: t.str.comment("Content to write to the file"),
  }),
}).comment("Creates a new file with the specified content");

async function validate(toolCall: t.GetType<typeof Schema>) {
  try {
    await fileTracker.assertCanCreate(toolCall.params.filePath);
  } catch(e) {
    if(e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return null;
}

export default {
  Schema, validate,
  async run(call, context) {
    await validate(call.tool);
    const { filePath, content } = call.tool.params;
    return attempt(`Failed to create file ${filePath}`, async () => {
      const absolutePath = await fileTracker.write(filePath, content);
      context.tracker("files").track({
        content, absolutePath,
        historyId: call.id,
      });
      return `Successfully created file ${filePath}`;
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
