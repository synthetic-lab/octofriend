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
    name: t.value("lsp-references"),
    arguments: LspPositionArgumentsSchema,
  })
  .comment("Find all references to a symbol at the given position.");

export default defineTool<{
  name: "lsp-references";
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
        "references",
        (client, filePath, line, character) => client.getReferences(filePath, line, character),
        (refs, filePath, line, character) =>
          `References for symbol at ${filePath}:${line}:${character}:\n${formatLocations(refs)}`,
      );
    },
  };
});
