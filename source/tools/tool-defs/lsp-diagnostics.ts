import { t } from "structural";
import { defineTool } from "../common.ts";
import { formatDiagnostics } from "../../lsp/client.ts";
import {
  LspFileOnlyArgumentsSchema,
  runLspFileQuery,
  getLspExtensionsComment,
} from "../lsp-common.ts";
import { isLspGloballyDisabled, getUsableLspExtensions } from "../../lsp/detect.ts";

function createSchema(extensions: Set<string>) {
  return t
    .subtype({
      name: t.value("lsp-diagnostics"),
      arguments: LspFileOnlyArgumentsSchema,
    })
    .comment(
      `Get errors and warnings for a file from the language server. ${getLspExtensionsComment(extensions)}`,
    );
}

export default defineTool<{
  name: "lsp-diagnostics";
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
        "diagnostics",
        async (client, filePath) => {
          const diagnosticsMinVersion = client.getDiagnosticsVersion();
          return client.getDiagnostics(filePath, diagnosticsMinVersion);
        },
        (diagnostics, filePath) =>
          `Diagnostics for ${filePath}:\n${formatDiagnostics(diagnostics)}`,
      );
    },
  };
});
