import { t } from "structural";
import { defineTool } from "../common.ts";
import {
  LspPositionArgumentsSchema,
  runLspPositionQuery,
  getLspExtensionsComment,
} from "../lsp-common.ts";
import { isLspGloballyDisabled, getUsableLspExtensions } from "../../lsp/detect.ts";

function createSchema(extensions: Set<string>) {
  return t
    .subtype({
      name: t.value("lsp-hover"),
      arguments: LspPositionArgumentsSchema,
    })
    .comment(
      `Get type info and documentation for a symbol at the given position. Use this to see type information, function signatures, or documentation. ${getLspExtensionsComment(extensions)}`,
    );
}

export default defineTool<{
  name: "lsp-hover";
  arguments: t.GetType<typeof LspPositionArgumentsSchema>;
}>(async (_signal, _transport, config) => {
  if (isLspGloballyDisabled(config)) return null;

  const extensions = getUsableLspExtensions(config);
  if (extensions.size === 0) return null;

  const Schema = createSchema(extensions);

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
