import { t } from "structural";
import { fileTracker } from "../file-tracker.ts";
import { TOOL, fileMutateIR } from "../common.ts";

export const ArgumentsSchema = t.subtype({
  filePath: t.str.comment("Path where the file should be created"),
  content: t.str.comment("Content to write to the file"),
});

const create = TOOL.declare({
  name: "create",
  description: "Creates a new file with the specified content",
  ArgumentsSchema,
});

export default create.withCustomIR({ fileMutateIR }).define(async () => ({
  async validate(signal, transport, toolCall) {
    return fileTracker.assertCanCreate(transport, signal, toolCall.parsed.arguments.filePath);
  },
  async run({ signal, transport, toolCall, customIR }) {
    const { filePath, content } = toolCall.parsed.arguments;
    const validation = await fileTracker.assertCanCreate(transport, signal, filePath);
    if (!validation.success) return validation;
    const written = await fileTracker.write(transport, signal, filePath, content);
    if (!written.success) return written;
    return customIR.fileMutateIR({ content: "" });
  },
}));
