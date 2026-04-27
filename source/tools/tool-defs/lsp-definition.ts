import { t } from "structural";
import { defineTool } from "../common.ts";
import { formatLocations } from "../../lsp/client.ts";
import type { Config } from "../../config.ts";
import type { Transport } from "../../transports/transport-common.ts";
import {
  LspPositionArgumentsSchema,
  runLspPositionQuery,
  getLspExtensionsComment,
} from "../lsp-common.ts";
import { isLspGloballyDisabled, getUsableLspExtensions } from "../../lsp/detect.ts";

function createSchema(extensions: Set<string>) {
  return t
    .subtype({
      name: t.value("lsp-definition"),
      arguments: LspPositionArgumentsSchema,
    })
    .comment(
      `Find the definition location of a symbol at the given position. Use this when you need to see where a symbol was originally defined. ${getLspExtensionsComment(extensions)}`,
    );
}

export default defineTool<{
  name: "lsp-definition";
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
        "definition",
        (client, filePath, line, character) => client.getDefinition(filePath, line, character),
        (locations, filePath, line, character) =>
          `Definition results for ${filePath}:${line}:${character}:\n${formatLocations(locations)}`,
      );
    },
  };
});
