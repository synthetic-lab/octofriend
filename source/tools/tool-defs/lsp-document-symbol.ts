import { t } from "structural";
import { defineTool } from "../common.ts";
import { formatDocumentSymbols } from "../../lsp/client.ts";
import {
  LspFileOnlyArgumentsSchema,
  runLspFileQuery,
  getLspExtensionsComment,
} from "../lsp-common.ts";
import { isLspGloballyDisabled, getUsableLspExtensions } from "../../lsp/detect.ts";

function createSchema(extensions: Set<string>) {
  return t
    .subtype({
      name: t.value("lsp-document-symbol"),
      arguments: LspFileOnlyArgumentsSchema,
    })
    .comment(
      `List all symbols (functions, classes, variables, etc.) in a file. ${getLspExtensionsComment(extensions)}`,
    );
}

export default defineTool<{
  name: "lsp-document-symbol";
  arguments: t.GetType<typeof LspFileOnlyArgumentsSchema>;
}>(async (_signal, transport, config) => {
  if (isLspGloballyDisabled(config)) return null;

  const extensions = await getUsableLspExtensions(transport.cwd, config);
  if (extensions.size === 0) return null;

  const Schema = createSchema(extensions);

  return {
    Schema,
    ArgumentsSchema: LspFileOnlyArgumentsSchema,
    validate: async () => null,

    async run(abortSignal, transport, call, config, _modelOverride) {
      return runLspFileQuery(
        abortSignal,
        transport,
        config,
        call.arguments,
        "document symbol",
        (client, filePath) => client.getDocumentSymbols(filePath),
        (symbols, filePath) => `Symbols in ${filePath}:\n${formatDocumentSymbols(symbols)}`,
      );
    },
  };
});
