import { t } from "structural";
import { TOOL, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { AbortError } from "../../transports/transport-common.ts";
import { findFiles } from "../../transports/transport-common.ts";
import { estimateTokens } from "../../ir/count-ir-tokens.ts";
import { ok, err } from "../../result.ts";

export default TOOL.declare({
  name: "glob",
  description: `
Finds files on the filesystem, using a safe subset of Unix \`find\` syntax. Prefer this to shelling
out to \`find\`.

Note that this searches the entire cwd, which may be very large (i.e. consider that there may be
deeply-nested directories with large amounts of files). Do NOT search for overly broad patterns,
like *.rb: instead, use targeted search terms for specifically what you want to find, like
*user-data*.rb if you're searching for a file for user data for example.

The glob tool automatically excludes common depedency directories such as node_modules, but do not
depend on this fact: there may be directories that it doesn't know it should ignore. Keep your glob
terms scoped and specific.
`.trim(),
  ArgumentsSchema: t.subtype({
    cwd: t.optional(t.str),
    search: t.partial(
      t.subtype({
        name: t.str.comment("-name pattern (e.g. *file-pattern*.js)"),
        caseInsensitive: t.bool.comment(
          "Use case-insensitive matching for the name pattern (uses -iname instead of -name)",
        ),
        path: t.str.comment("-path pattern (e.g. */test/*)"),
        maxDepth: t.num.comment("The max depth of directories to search"),
        type: t.value("file").or(t.value("directory")),
        excludeFilename: t.str.comment("Exclude files matching this -name pattern (e.g. *.d.ts)"),
        excludePath: t.str.comment("Exclude paths matching this -path pattern (e.g. */test/*)"),
        maxResults: t.num.comment("Max number of results to return"),
      }),
    ),
  }),
}).define(async () => ({
  async run({ signal, transport, toolCall, data }) {
    const { cwd, search } = toolCall.parsed.arguments;
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
      const { context } = getModelFromConfig(data, null);
      const tok = estimateTokens(text);
      if (tok > context) {
        return err(`Find content was too large: approx ${tok} tokens returned`);
      }
      return ok({
        type: "output",
        content: [{ type: "text", content: text }],
      });
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) {
        return err(USER_ABORTED_ERROR_MESSAGE);
      }
      throw e;
    }
  },
}));
