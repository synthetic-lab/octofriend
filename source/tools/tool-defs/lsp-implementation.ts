import { t } from "structural";
import { BASE_IR, toolOutput } from "../common.ts";
import { formatLocations } from "../../lsp/client.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default BASE_IR.dynamicDefineTool(async function ({ transport, data }) {
  const extensions = await getUsableLspExtensions(transport.cwd, data);
  if (extensions.size === 0) return null;

  const ArgumentsSchema = t.subtype({
    filePath: t.str.comment("Path to the file to query"),
    line: LineSchema,
    character: CharSchema,
  });

  const Schema = t
    .subtype({
      name: t.value("lsp-implementation"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `Find implementation locations, jumping past interfaces and abstract classes to the code that implements them. ${getLspExtensionsComment(extensions)}`,
    );

  return BASE_IR.declare({
    name: "lsp-implementation",
    ArgumentsSchema,
  }).define(async () => ({
    async run({ signal, toolCall }) {
      const output = await runLspPositionQuery(
        signal,
        transport,
        data,
        toolCall.parsed.arguments,
        "implementation",
        (client, filePath, line, character) => client.getImplementation(filePath, line, character),
        (locations, filePath, line, character) =>
          `Implementation results for ${filePath}:${line}:${character}:\n${formatLocations(locations)}`,
      );
      return toolOutput(output.content);
    },
  }));
});
