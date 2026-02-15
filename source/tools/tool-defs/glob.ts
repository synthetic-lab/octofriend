import { t } from "structural";
import { attempt, defineTool, ToolError } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";

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

function globToRegex(pattern: string): RegExp {
  let regex = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        regex += ".*";
        i += 2;
      } else {
        regex += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      regex += ".";
      i++;
    } else if (c === "[") {
      const close = pattern.indexOf("]", i);
      if (close === -1) {
        regex += "\\[";
        i++;
      } else {
        regex += pattern.slice(i, close + 1);
        i = close + 1;
      }
    } else if ("\\^$.|+(){}".includes(c)) {
      regex += "\\" + c;
      i++;
    } else {
      regex += c;
      i++;
    }
  }
  return new RegExp(regex + "$");
}

async function globRecursive(
  signal: AbortSignal,
  transport: Transport,
  dirPath: string,
  regex: RegExp,
  results: Array<{ path: string; isDirectory: boolean }>,
  visited: Set<string>,
): Promise<void> {
  const resolved = await transport.resolvePath(signal, dirPath);
  if (visited.has(resolved)) return;
  visited.add(resolved);

  const entries = await transport.readdir(signal, dirPath);
  for (const entry of entries) {
    const fullPath = await transport.resolvePath(signal, dirPath + "/" + entry.entry);
    const relativePath = fullPath.replace(resolved + "/", "").replace(resolved, "");
    const matchPath = relativePath || entry.entry;

    if (regex.test(matchPath)) {
      results.push({ path: fullPath, isDirectory: entry.isDirectory });
    }

    if (entry.isDirectory) {
      await globRecursive(signal, transport, fullPath, regex, results, visited);
    }
  }
}

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
      const visited = new Set<string>();

      await globRecursive(abortSignal, transport, searchPath, regex, results, visited);

      return {
        content: results.map(r => JSON.stringify(r)).join("\n"),
      };
    });
  },
}));
