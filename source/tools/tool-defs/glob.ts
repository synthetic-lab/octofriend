import { t } from "structural";
import { TOOL, USER_ABORTED_ERROR_MESSAGE } from "../common.ts";
import { getModelFromConfig } from "../../config.ts";
import { AbortError } from "../../transports/transport-common.ts";
import { findFiles } from "../../transports/transport-common.ts";
import { estimateTokens } from "../../ir/count-ir-tokens.ts";
import { ok, err, toErrString } from "../../libocto/result.ts";

export default TOOL.declare({
  name: "glob",
  description: `
Finds files on the filesystem, using a safe subset of Unix \`find\` syntax. Prefer this to shelling
out to \`find\`.

Note that this searches the entire cwd, which may be very large (i.e. consider that there may be
deeply-nested directories with large amounts of files). Do NOT search for overly broad patterns,
like *.rb: instead, use targeted search terms for specifically what you want to find, like
*user-data*.rb if you're searching for a file for user data for example.

The glob tool automatically excludes common dependency directories such as node_modules, but do not
depend on this fact: there may be directories that it doesn't know it should ignore. Keep your glob
terms scoped and specific.
`.trim(),
  ArgumentsSchema: t.partial(
    t.subtype({
      path: t.str.comment(
        "The directory to search from. Finds files recursively within this directory. Defaults to the current working directory.",
      ),
      includeName: t.str.comment(
        "Filename (basename) glob pattern for files to include (e.g. *file-pattern*.js). Path segments should not be part of this pattern.",
      ),
      excludeName: t.str.comment(
        "Filename (basename) glob pattern for files to exclude (e.g. *.d.ts). Path segments should not be part of this pattern.",
      ),
      includePath: t.str.comment(
        "File path glob pattern for files to include (e.g. */src/* for files inside src directories).",
      ),
      excludePath: t.str.comment(
        "File path glob pattern for files to exclude (e.g. */test/* for files inside test directories).",
      ),
      caseInsensitive: t.bool.comment(
        "Use case-insensitive matching for the filename glob pattern. Exclusion patterns are not affected by this flag and are always case-sensitive.",
      ),
      maxDepth: t.num.comment("The max depth of directories to search"),
      maxResults: t.num.comment("Max number of results to return"),
    }),
  ),
}).define(async () => ({
  async run({ signal, transport, toolCall, data }) {
    const search = toolCall.parsed.arguments;
    try {
      const files = await findFiles(signal, transport, { ...search });
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
      return toErrString(e);
    }
  },
}));
