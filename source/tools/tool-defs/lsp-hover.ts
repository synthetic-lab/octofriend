import { t } from "structural";
import { defineTool } from "../common.ts";
import type { Config } from "../../config.ts";
import type { Transport } from "../../transports/transport-common.ts";
import { LspPositionArgumentsSchema, runLspPositionQuery } from "../lsp-common.ts";
import { isLspGloballyDisabled, getUsableLspExtensions } from "../../lsp/detect.ts";

const Schema = t
  .subtype({
    name: t.value("lsp-hover"),
    arguments: LspPositionArgumentsSchema,
  })
  .comment(
    "Get type info and documentation for a symbol at the given position. Use this to see type information, function signatures, or documentation.",
  );

export default defineTool<{
  name: "lsp-hover";
  arguments: t.GetType<typeof LspPositionArgumentsSchema>;
}>(async (_signal, _transport, config) => {
  if (isLspGloballyDisabled(config)) return null;

  const extensions = getUsableLspExtensions(config);
  if (extensions.size === 0) return null;

  return {
    Schema,
    ArgumentsSchema: LspPositionArgumentsSchema,
    validate: async () => null,

    async run(abortSignal, transport, call, config, _modelOverride) {
      return runLspPositionQuery(
        abortSignal,
        transport,
        config,
        call.arguments,
        "hover",
        (client, filePath, line, character) => client.getHover(filePath, line, character),
        (hover, filePath, line, character) =>
          `Hover info for ${filePath}:${line}:${character}:\n${hover ?? "No hover information available."}`,
      );
    },
  };
});
