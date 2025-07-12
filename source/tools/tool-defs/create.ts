import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { ToolError, attempt, ToolDef } from "../common.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path where the file should be created"),
  content: t.str.comment("Content to write to the file"),
});

const Schema = t.subtype({
  name: t.value("create"),
  arguments: ArgumentsSchema,
}).comment("Creates a new file with the specified content");

async function validate(toolCall: t.GetType<typeof Schema>) {
  try {
    await fileTracker.assertCanCreate(toolCall.arguments.filePath);
  } catch(e) {
    if(e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return null;
}

export default {
  Schema, ArgumentsSchema, validate,
  async run(call, context) {
    await validate(call.tool);
    const { filePath, content } = call.tool.arguments;
    return attempt(`Failed to create file ${filePath}`, async () => {
      const absolutePath = await fileTracker.write(filePath, content);
      context.tracker("files").track({
        absolutePath,
        historyId: call.id,
      });
      return `Successfully created file ${filePath}. The file has been added to your context space.`;
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
