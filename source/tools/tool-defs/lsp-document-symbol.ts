import { t } from "structural";
import { BASE_IR, toolOutput } from "../common.ts";
import { formatDocumentSymbols } from "../../lsp/client.ts";
import { runLspFileQuery, getLspExtensionsComment } from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default BASE_IR.dynamicDefineTool(async function ({ transport, data }) {
  const extensions = await getUsableLspExtensions(transport.cwd, data);
  if (extensions.size === 0) return null;

  const ArgumentsSchema = t.subtype({
    filePath: t.str.comment("Path to the file to query"),
  });

  const Schema = t
    .subtype({
      name: t.value("lsp-document-symbol"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `List all symbols (functions, classes, variables, etc.) in a file. ${getLspExtensionsComment(extensions)}`,
    );

  return BASE_IR.declare({
    name: "lsp-document-symbol",
    ArgumentsSchema,
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
      return toolOutput(output.data.content);
    },
  }));
});
