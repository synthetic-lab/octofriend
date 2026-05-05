import { t } from "structural";
import { autoparse, dynamicDefineTool, ToolDef } from "../common.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default dynamicDefineTool("lsp-hover", async function (_, transport, config) {
  const extensions = await getUsableLspExtensions(transport.cwd, config);
  if (extensions.size === 0) return null;

  const ArgumentsSchema = t.subtype({
    filePath: t.str.comment("Path to the file to query"),
    line: LineSchema,
    character: CharSchema,
  });

  const Schema = t
    .subtype({
      name: t.value("lsp-hover"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `Get type info and documentation for a symbol at the given position. Use this to see type information, function signatures, or documentation. ${getLspExtensionsComment(extensions)}`,
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
        "hover",
        (client, filePath, line, character) => client.getHover(filePath, line, character),
        (hover, filePath, line, character) =>
          `Hover info for ${filePath}:${line}:${character}:\n${hover ?? "No hover information available."}`,
      );
    },
  } satisfies ToolDef<
    "lsp-hover",
    t.GetType<typeof ArgumentsSchema>,
    t.GetType<typeof ArgumentsSchema>
  >;
});
