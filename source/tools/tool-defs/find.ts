import { t } from "structural";
import { ToolError, defineTool, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { AbortError } from "../../transports/transport-common.ts";
import { findFiles } from "../../transports/transport-common.ts";

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
    name: t.value("find"),
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
        type: search.type == null ? undefined : search.name === "file" ? "f" : "d",
      });
      const text = files.join("\n");
      const { context } = getModelFromConfig(config, modelOverride);
      if (text.length > context) {
        throw new ToolError(`Web content too large: ${text.length} bytes (max: ${context} bytes)`);
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
