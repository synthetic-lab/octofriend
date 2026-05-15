import { t } from "structural";
import { TOOL } from "../common.ts";
import { ok } from "../../result.ts";
import { formatDiagnostics } from "../../lsp/client.ts";
import { runLspFileQuery, getLspExtensionsComment } from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default TOOL.dynamicDefineTool(async function ({ transport, data }) {
  const extensions = await getUsableLspExtensions(transport.cwd, data);
  if (extensions.size === 0) return null;

  const description = `Get errors and warnings for a file from the language server. ${getLspExtensionsComment(extensions)}`;

  return TOOL.declare({
    name: "lsp-diagnostics",
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
        "diagnostics",
        async (client, filePath) => {
          const diagnosticsMinVersion = client.getDiagnosticsVersion();
          return client.getDiagnostics(filePath, diagnosticsMinVersion);
        },
        (diagnostics, filePath) =>
          `Diagnostics for ${filePath}:\n${formatDiagnostics(diagnostics)}`,
      );
      if (!output.success) return output;
      return ok({
        type: "output",
        content: [{ type: "text", content: output.data.content }],
      });
    },
  }));
});
