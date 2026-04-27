import { t } from "structural";
import { defineTool } from "../common.ts";
import { formatCallHierarchy } from "../../lsp/client.ts";
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
      name: t.value("lsp-incoming-calls"),
      arguments: LspPositionArgumentsSchema,
    })
    .comment(
      `Find all callers of a symbol at the given position. ${getLspExtensionsComment(extensions)}`,
    );
}

export default defineTool<{
  name: "lsp-incoming-calls";
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
        "incoming calls",
        (client, filePath, line, character) => client.getIncomingCalls(filePath, line, character),
        (calls, filePath, line, character) =>
          `Incoming calls to symbol at ${filePath}:${line}:${character}:\n${formatCallHierarchy(calls, "incoming")}`,
      );
    },
  };
});
