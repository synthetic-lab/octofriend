import { t } from "structural";
import { autoparse, dynamicDefineTool, ToolDef } from "../common.ts";
import { formatDiagnostics } from "../../lsp/client.ts";
import { runLspFileQuery, getLspExtensionsComment } from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default dynamicDefineTool("lsp-diagnostics", async function (_, transport, config) {
  const extensions = await getUsableLspExtensions(transport.cwd, config);
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
        "diagnostics",
        async (client, filePath) => {
          const diagnosticsMinVersion = client.getDiagnosticsVersion();
          return client.getDiagnostics(filePath, diagnosticsMinVersion);
        },
        (diagnostics, filePath) =>
          `Diagnostics for ${filePath}:\n${formatDiagnostics(diagnostics)}`,
      );
    },
  } satisfies ToolDef<
    "lsp-diagnostics",
    t.GetType<typeof ArgumentsSchema>,
    t.GetType<typeof ArgumentsSchema>
  >;
});
