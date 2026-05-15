import { t } from "structural";
import { TOOL, toolOutput } from "../common.ts";
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

  const description = `Get type info and documentation for a symbol at the given position. Use this to see type information, function signatures, or documentation. ${getLspExtensionsComment(extensions)}`;

  return TOOL.declare({
    name: "lsp-hover",
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
        "hover",
        (client, filePath, line, character) => client.getHover(filePath, line, character),
        (hover, filePath, line, character) =>
          `Hover info for ${filePath}:${line}:${character}:\n${hover ?? "No hover information available."}`,
      );
      if (!output.success) return output;
      return toolOutput(output.data.content);
    },
  }));
});
