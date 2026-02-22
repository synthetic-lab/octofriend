import { t } from "structural";
import { attempt, defineTool, ToolError } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { walkDirectory, globToRegex } from "../utils.ts";

const ArgumentsSchema = t.subtype({
  pattern: t.str.comment("Glob pattern like '**/*.ts' or 'src/**/*.tsx'"),
  path: t.optional(t.str.comment("Directory to search in (defaults to current directory)")),
});

const Schema = t
  .subtype({
    name: t.value("glob"),
    arguments: ArgumentsSchema,
  })
  .comment(
    `Finds files by name pattern. Prefer this to shell commands like \`find\` or \`ls\`.

Pattern guidance:
- Use "**/*.ext" to find all files with a specific extension (e.g., "**/*.ts")
- Use "prefix*.ext" to find files starting with a prefix (e.g., "test*.ts")
- Use "**/specific-file.ext" to find a file anywhere in the tree
- Be specific with your patterns to avoid matching too many files and wasting context
- Prefer narrowing by file extension first before using grep to search file contents`,
  );

export default defineTool<t.GetType<typeof Schema>>(async () => ({
  Schema,
  ArgumentsSchema,
  async validate() {
    return null;
  },
  async run(abortSignal, transport, call) {
    const { pattern } = call.arguments;
    const searchPath = call.arguments?.path || (await transport.cwd(abortSignal));

    return attempt(`Glob failed for pattern: ${pattern}`, async () => {
      const regex = globToRegex(pattern);
      const results: Array<{ path: string; isDirectory: boolean }> = [];

      await walkDirectory(
        abortSignal,
        transport,
        searchPath,
        ({ path, name, resolvedBase, isDirectory }) => {
          const relativePath = path.replace(resolvedBase + "/", "").replace(resolvedBase, "");
          const matchPath = relativePath || name;

          if (regex.test(matchPath)) {
            results.push({ path, isDirectory });
          }
        },
      );

      return {
        content: results.map(r => JSON.stringify(r)).join("\n"),
      };
    });
  },
}));
