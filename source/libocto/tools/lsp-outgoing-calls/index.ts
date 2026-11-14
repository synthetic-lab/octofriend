import { t } from "structural";
import { TOOL_BUILDER } from "../tool-def.ts";
import type { LspToolData } from "../../lsp/detect.ts";
import { ok } from "../../result.ts";
import { formatCallHierarchy } from "../../lsp/client.ts";
import {
  runLspPositionQuery,
  getLspExtensionsComment,
  LineSchema,
  CharSchema,
} from "../../lsp/lsp-common.ts";
import { getUsableLspExtensions } from "../../lsp/detect.ts";

export default TOOL_BUILDER.withData<LspToolData>().dynamicDefineTool(async function ({
  signal,
  transport,
  data,
}) {
  const extensions = await getUsableLspExtensions(signal, transport.cwd, data, transport);
  if (extensions.size === 0) return null;

  const description = `Find all callees of a symbol at the given position. ${getLspExtensionsComment(extensions)}`;

  return TOOL_BUILDER.withData<LspToolData>()
    .declare({
      name: "lsp-outgoing-calls",
      description,
      ArgumentsSchema: t.subtype({
        filePath: t.str.comment("Path to the file to query"),
        line: LineSchema,
        character: CharSchema,
      }),
    })
    .define(async () => ({
      async run({ signal, toolCall }) {
        const output = await runLspPositionQuery(
          signal,
          transport,
          data,
          toolCall.parsed.arguments,
          "outgoing calls",
          (client, filePath, line, character) => client.getOutgoingCalls(filePath, line, character),
          (calls, filePath, line, character) =>
            `Outgoing calls from symbol at ${filePath}:${line}:${character}:\n${formatCallHierarchy(calls, "outgoing")}`,
        );
        if (!output.success) return output;
        return ok({
          type: "output",
          content: [{ type: "text", content: output.data.content }],
        });
      },
    }));
});
