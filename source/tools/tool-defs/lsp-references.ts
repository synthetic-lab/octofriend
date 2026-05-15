import { t } from "structural";
import { BASE_IR, toolOutput } from "../common.ts";
import { formatLocations } from "../../lsp/client.ts";
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

  const description = `Find all references to a symbol at the given position. ${getLspExtensionsComment(extensions)}`;

  return BASE_IR.declare({
    name: "lsp-references",
    description,
    ArgumentsSchema: t.subtype({
      filePath: t.str.comment("Path to the file to query"),
      line: LineSchema,
      character: CharSchema,
    }),
  }).define(async () => ({
    async run({ signal, toolCall }) {
      const output = await runLspPositionQuery(
        signal,
        transport,
        data,
        toolCall.parsed.arguments,
        "references",
        (client, filePath, line, character) => client.getReferences(filePath, line, character),
        (refs, filePath, line, character) =>
          `References for symbol at ${filePath}:${line}:${character}:\n${formatLocations(refs)}`,
      );
      if (!output.success) return output;
      return toolOutput(output.data.content);
    },
  }));
});
