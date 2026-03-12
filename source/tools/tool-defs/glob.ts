import { t } from "structural";
import { ToolError, defineTool, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { AbortError } from "../../transports/transport-common.ts";
import { findFiles } from "../../transports/transport-common.ts";
import { estimateTokens } from "../../ir/count-ir-tokens.ts";

const ArgumentsSchema = t.subtype({
  cwd: t.optional(t.str),
  search: t.partial(
    t.subtype({
      name: t.str.comment("-name pattern (e.g. *file-pattern*.js)"),
      path: t.str.comment("-path pattern (e.g. */test/*)"),
      maxDepth: t.num.comment("The max depth of directories to search"),
      type: t.value("file").or(t.value("directory")),
    }),
  ),
});

const Schema = t
  .subtype({
    name: t.value("glob"),
    arguments: ArgumentsSchema,
  })
  .comment(
    "Finds files on the filesystem, using a safe subset of Unix `find` syntax. Prefer this to shelling out to `find`.",
  );

export default defineTool<t.GetType<typeof Schema>>(async () => ({
  Schema,
  ArgumentsSchema,
  validate: async () => null,
  async run(signal, transport, call, config, modelOverride) {
    const { cwd, search } = call.arguments;
    try {
      const files = await findFiles(signal, transport, {
        cwd,
        ...search,
        type: (() => {
          if (search.type == null) return undefined;
          if (search.type === "file") return "f";
          const _: "directory" = search.type;
          return "d";
        })(),
      });
      const text = files.join("\n");
      const { context } = getModelFromConfig(config, modelOverride);
      const tok = estimateTokens(text);
      if (tok > context) {
        throw new ToolError(`Find content was too large: approx ${tok} tokens returned`);
      }
      return { content: text };
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) {
        throw new ToolError(USER_ABORTED_ERROR_MESSAGE);
      }
      throw e;
    }
  },
}));
