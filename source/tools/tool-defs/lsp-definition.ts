import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok } from "../../libocto/result.ts";
import { formatLocations } from "../../lsp/client.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default TOOL.dynamicDefineTool(async function ({ transport, data }) {
  const extensions = await getUsableLspExtensions(transport.cwd, data);
  if (extensions.size === 0) return null;

  const description = `Find the definition location of a symbol at the given position. Use this when you need to see where a symbol was originally defined. ${getLspExtensionsComment(extensions)}`;

  return TOOL.declare({
    name: "lsp-definition",
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
        "definition",
        (client, filePath, line, character) => client.getDefinition(filePath, line, character),
        (locations, filePath, line, character) =>
          `Definition results for ${filePath}:${line}:${character}:\n${formatLocations(locations)}`,
      );
      if (!output.success) return output;
      return ok({
        type: "output",
        content: [{ type: "text", content: output.data.content }],
      });
    },
  }));
});
