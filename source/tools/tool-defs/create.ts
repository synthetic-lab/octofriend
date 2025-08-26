import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { ToolError, attempt, ToolDef } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path where the file should be created"),
  content: t.str.comment("Content to write to the file"),
});

const Schema = t.subtype({
  name: t.value("create"),
  arguments: ArgumentsSchema,
}).comment("Creates a new file with the specified content");

async function validate(signal: AbortSignal, transport: Transport, toolCall: t.GetType<typeof Schema>) {
  try {
    await fileTracker.assertCanCreate(transport, signal, toolCall.arguments.filePath);
  } catch(e) {
    if(e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return null;
}

export default {
  Schema, ArgumentsSchema, validate,
  async run(signal, transport, call) {
    await validate(signal, transport, call.tool);
    const { filePath, content } = call.tool.arguments;
    return attempt(`Failed to create file ${filePath}`, async () => {
      await fileTracker.write(transport, signal, filePath, content);
      return {
        content: "",
        lines: content.split("\n").length,
      };
    });
  },
} satisfies ToolDef<t.GetType<typeof Schema>>;
