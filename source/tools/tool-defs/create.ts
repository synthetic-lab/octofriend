import { t } from "structural";
import { fileTracker, FileExistsError } from "../file-tracker.ts";
import { attempt, TOOL, fileMutateIR } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { ok, err } from "../../result.ts";

export const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path where the file should be created"),
  content: t.str.comment("Content to write to the file"),
});

async function validate(signal: AbortSignal, transport: Transport, filePath: string) {
  try {
    await fileTracker.assertCanCreate(transport, signal, filePath);
  } catch (e) {
    if (e instanceof FileExistsError) return err(e.message);
    throw e;
  }
  return ok(null);
}

const create = TOOL.declare({
  name: "create",
  description: "Creates a new file with the specified content",
  ArgumentsSchema,
});

export default create.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return validate(signal, transport, toolCall.original.arguments.filePath);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath, content } = toolCall.parsed.arguments;
    const validation = await validate(signal, transport, filePath);
    if (!validation.success) return validation;
    return attempt(`Failed to create file ${filePath}`, async () => {
      await fileTracker.write(transport, signal, filePath, content);
      return customIR.fileMutateIR({ content: "" });
    });
  },
}));
