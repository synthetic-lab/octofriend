import { t } from "structural";
import { autoparse, dynamicDefineTool, ToolDef } from "../common.ts";
import { formatLocations } from "../../lsp/client.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default dynamicDefineTool("lsp-definition", async function (_, transport, config) {
  const extensions = await getUsableLspExtensions(transport.cwd, config);
  if (extensions.size === 0) return null;

  const ArgumentsSchema = t.subtype({
    filePath: t.str.comment("Path to the file to query"),
    line: LineSchema,
    character: CharSchema,
  });

  const Schema = t
    .subtype({
      name: t.value("lsp-definition"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `Find the definition location of a symbol at the given position. Use this when you need to see where a symbol was originally defined. ${getLspExtensionsComment(extensions)}`,
    );

  return {
    Schema,
    ArgumentsSchema,
    async validate() {
      return null;
    },
    ...autoparse(ArgumentsSchema),
    async run(abortSignal, _2, call) {
      return runLspPositionQuery(
        abortSignal,
        transport,
        config,
        call.parsed.arguments,
        "definition",
        (client, filePath, line, character) => client.getDefinition(filePath, line, character),
        (locations, filePath, line, character) =>
          `Definition results for ${filePath}:${line}:${character}:\n${formatLocations(locations)}`,
      );
    },
  } satisfies ToolDef<
    "lsp-definition",
    t.GetType<typeof ArgumentsSchema>,
    t.GetType<typeof ArgumentsSchema>
  >;
});
