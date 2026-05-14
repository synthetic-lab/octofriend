import { t } from "structural";
import { BASE_IR, toolOutput } from "../common.ts";
import { formatDiagnostics } from "../../lsp/client.ts";
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
      name: t.value("lsp-diagnostics"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `Get errors and warnings for a file from the language server. ${getLspExtensionsComment(extensions)}`,
    );

  return BASE_IR.declare({
    name: "lsp-diagnostics",
    ArgumentsSchema,
  }).define(async () => ({
    async run({ signal, toolCall }) {
      const output = await runLspFileQuery(
        signal,
        transport,
        data,
        toolCall.parsed.arguments,
        "diagnostics",
        async (client, filePath) => {
          const diagnosticsMinVersion = client.getDiagnosticsVersion();
          return client.getDiagnostics(filePath, diagnosticsMinVersion);
        },
        (diagnostics, filePath) =>
          `Diagnostics for ${filePath}:\n${formatDiagnostics(diagnostics)}`,
      );
      return toolOutput(output.content);
    },
  }));
});
