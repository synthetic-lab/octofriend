import { t } from "structural";
import { BASE_IR, toolOutput } from "../common.ts";
import { formatCallHierarchy } from "../../lsp/client.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default BASE_IR.dynamicDefineTool(async function ({ transport, data }) {
  const extensions = await getUsableLspExtensions(transport.cwd, data);
  if (extensions.size === 0) return null;

  const ArgumentsSchema = t.subtype({
    filePath: t.str.comment("Path to the file to query"),
    line: LineSchema,
    character: CharSchema,
  });

  const description = `Find all callers of a symbol at the given position. ${getLspExtensionsComment(extensions)}`;

  return BASE_IR.declare({
    name: "lsp-incoming-calls",
    description,
    ArgumentsSchema,
  }).define(async () => ({
    async run({ signal, toolCall }) {
      const output = await runLspPositionQuery(
        signal,
        transport,
        data,
        toolCall.parsed.arguments,
        "incoming calls",
        (client, filePath, line, character) => client.getIncomingCalls(filePath, line, character),
        (calls, filePath, line, character) =>
          `Incoming calls to symbol at ${filePath}:${line}:${character}:\n${formatCallHierarchy(calls, "incoming")}`,
      );
      if (!output.success) return output;
      return toolOutput(output.data.content);
    },
  }));
});
