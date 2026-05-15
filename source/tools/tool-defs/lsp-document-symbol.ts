import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok } from "../../result.ts";
import { formatDocumentSymbols } from "../../lsp/client.ts";
import { runLspFileQuery, getLspExtensionsComment } from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default TOOL.dynamicDefineTool(async function ({ transport, data }) {
  const extensions = await getUsableLspExtensions(transport.cwd, data);
  if (extensions.size === 0) return null;

  const description = `List all symbols (functions, classes, variables, etc.) in a file. ${getLspExtensionsComment(extensions)}`;

  return TOOL.declare({
    name: "lsp-document-symbol",
    description,
    ArgumentsSchema: t.subtype({
      filePath: t.str.comment("Path to the file to query"),
    }),
  }).define(async () => ({
    async run({ signal, toolCall }) {
      const output = await runLspFileQuery(
        signal,
        transport,
        data,
        toolCall.parsed.arguments,
        "document symbol",
        (client, filePath) => client.getDocumentSymbols(filePath),
        (symbols, filePath) => `Symbols in ${filePath}:\n${formatDocumentSymbols(symbols)}`,
      );
      if (!output.success) return output;
      return ok({
        type: "output",
        content: [{ type: "text", content: output.data.content }],
      });
    },
  }));
});
