import { t } from "structural";
import { defineTool } from "../common.ts";
import { formatDiagnostics } from "../../lsp/client.ts";
import type { Config } from "../../config.ts";
import type { Transport } from "../../transports/transport-common.ts";
import { LspFileOnlyArgumentsSchema, runLspFileQuery } from "../lsp-common.ts";
import { isLspGloballyDisabled, getUsableLspExtensions } from "../../lsp/detect.ts";

const Schema = t
  .subtype({
    name: t.value("lsp-diagnostics"),
    arguments: LspFileOnlyArgumentsSchema,
  })
  .comment("Get errors and warnings for a file from the language server.");

export default defineTool<{
  name: "lsp-diagnostics";
  arguments: t.GetType<typeof LspFileOnlyArgumentsSchema>;
}>(async (_signal, _transport, config) => {
  if (isLspGloballyDisabled(config)) return null;

  const extensions = getUsableLspExtensions(config);
  if (extensions.size === 0) return null;

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
