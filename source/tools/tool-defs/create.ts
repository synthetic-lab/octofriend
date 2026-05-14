import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { ToolError, attempt, BASE_IR, fileMutateIR } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { result } from "../../result.ts";

export const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path where the file should be created"),
  content: t.str.comment("Content to write to the file"),
});

const Schema = t
  .subtype({
    name: t.value("create"),
    arguments: ArgumentsSchema,
  })
  .comment("Creates a new file with the specified content");

async function validate(signal: AbortSignal, transport: Transport, filePath: string) {
  try {
    await fileTracker.assertCanCreate(transport, signal, filePath);
  } catch (e) {
    if (e instanceof FileExistsError) throw new ToolError(e.message);
    throw e;
  }
  return result.ok(null);
}

const create = BASE_IR.declare({
  name: "create",
  ArgumentsSchema,
});

export default create.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments.filePath);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath, content } = toolCall.parsed.arguments;
    await validate(signal, transport, filePath);
    return attempt(`Failed to create file ${filePath}`, async () => {
      await fileTracker.write(transport, signal, filePath, content);
      return customIR.fileMutateIR({ content: "" });
    });
  },
}));
