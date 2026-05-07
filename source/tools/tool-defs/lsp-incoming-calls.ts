import { t } from "structural";
import { autoparse, dynamicDefineTool, ToolDef } from "../common.ts";
import { formatCallHierarchy } from "../../lsp/client.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default dynamicDefineTool("lsp-incoming-calls", async function (_, transport, config) {
  const extensions = await getUsableLspExtensions(transport.cwd, config);
  if (extensions.size === 0) return null;

  const ArgumentsSchema = t.subtype({
    filePath: t.str.comment("Path to the file to query"),
    line: LineSchema,
    character: CharSchema,
  });

  const Schema = t
    .subtype({
      name: t.value("lsp-incoming-calls"),
      arguments: ArgumentsSchema,
    })
    .comment(
      `Find all callers of a symbol at the given position. ${getLspExtensionsComment(extensions)}`,
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
        "incoming calls",
        (client, filePath, line, character) => client.getIncomingCalls(filePath, line, character),
        (calls, filePath, line, character) =>
          `Incoming calls to symbol at ${filePath}:${line}:${character}:\n${formatCallHierarchy(calls, "incoming")}`,
      );
    },
  } satisfies ToolDef<
    "lsp-incoming-calls",
    t.GetType<typeof ArgumentsSchema>,
    t.GetType<typeof ArgumentsSchema>
  >;
});
