import { t } from "structural";
import { defineTool } from "../common.ts";
import { formatLocations } from "../../lsp/client.ts";
import type { Config } from "../../config.ts";
import type { Transport } from "../../transports/transport-common.ts";
import {
  LspPositionArgumentsSchema,
  runLspPositionQuery,
  shouldEnableLspTools,
} from "../lsp-common.ts";

const Schema = t
  .subtype({
    name: t.value("lsp-definition"),
    arguments: LspPositionArgumentsSchema,
  })
  .comment(
    "Find the definition location of a symbol at the given position. Use this when you need to see where a symbol was originally defined.",
  );

export default defineTool<{
  name: "lsp-definition";
  arguments: t.GetType<typeof LspPositionArgumentsSchema>;
}>(async (_signal, _transport, config) => {
  if (!shouldEnableLspTools(config)) return null;

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
