import { t } from "structural";
import { autoparse, dynamicDefineTool, ToolDef } from "../common.ts";
import { formatDocumentSymbols } from "../../lsp/client.ts";
import { runLspFileQuery, getLspExtensionsComment } from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default dynamicDefineTool("lsp-document-symbol", async function (_, transport, config) {
  const extensions = await getUsableLspExtensions(transport.cwd, config);
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

  return {
    Schema,
    ArgumentsSchema,
    async validate() {
      return null;
    },
    ...autoparse(ArgumentsSchema),
    async run(abortSignal, _2, call) {
      return runLspFileQuery(
        abortSignal,
        transport,
        config,
        call.parsed.arguments,
        "document symbol",
        (client, filePath) => client.getDocumentSymbols(filePath),
        (symbols, filePath) => `Symbols in ${filePath}:\n${formatDocumentSymbols(symbols)}`,
      );
    },
  } satisfies ToolDef<
    "lsp-document-symbol",
    t.GetType<typeof ArgumentsSchema>,
    t.GetType<typeof ArgumentsSchema>
  >;
});
