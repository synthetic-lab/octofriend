import { t } from "structural";
import { attempt, defineTool, ToolError } from "../common.ts";
import { Transport } from "../../transports/transport-common.ts";
import { walkDirectory, globToRegex } from "../utils.ts";

const ArgumentsSchema = t.subtype({
  pattern: t.str.comment("Regex pattern to search for"),
  path: t.optional(t.str.comment("Directory to search in (defaults to current directory)")),
  glob: t.optional(t.str.comment("Filter files by pattern (e.g., '*.ts')")),
  output: t.optional(t.str.comment('Output mode: "content" (default), "files", or "count"')),
  "-i": t.optional(t.bool.comment("Case-insensitive search")),
  "-C": t.optional(t.num.comment("Number of context lines to show before/after matches")),
});

const Schema = t
  .subtype({
    name: t.value("grep"),
    arguments: ArgumentsSchema,
  })
  .comment(
    `Searches file contents using regex. Prefer this to shell commands like \`grep\` or \`rg\`.

Output mode guidance:
- Use "files" when you just need to know which files contain matches (most efficient, minimal context)
- Use "count" when you need to know how many matches exist per file
- Use "content" (default) when you need to see the actual matching lines

If you're searching for common patterns that might match many lines, prefer "files" or "count" first,
then selectively read the specific files you need rather than dumping all matches into context.`,
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
    const globPattern = call.arguments?.glob;
    const outputMode = call.arguments?.output || "content";
    const caseInsensitive = call.arguments?.["-i"] || false;
    const contextLines = call.arguments?.["-C"] || 0;

    return attempt(`Grep failed for pattern: ${pattern}`, async () => {
      const flags = caseInsensitive ? "i" : "";
      const regex = new RegExp(pattern, flags);
      const globFilter = globPattern ? globToRegex(globPattern) : null;

      const results: Array<{
        path: string;
        lineNumber: number;
        line: string;
        contextBefore: string[];
        contextAfter: string[];
      }> = [];
      const fileMatchCounts = new Map<string, number>();

      await walkDirectory(
        abortSignal,
        transport,
        searchPath,
        async ({ path, name, isDirectory }) => {
          if (isDirectory) return;

          if (globFilter && !globFilter.test(name)) {
            return;
          }

          try {
            const content = await transport.readFile(abortSignal, path);
            const lines = content.split("\n");
            let fileMatches = 0;

            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                fileMatches++;
                const contextBefore = lines.slice(Math.max(0, i - contextLines), i);
                const contextAfter = lines.slice(
                  i + 1,
                  Math.min(lines.length, i + 1 + contextLines),
                );

                results.push({
                  path,
                  lineNumber: i + 1,
                  line: lines[i],
                  contextBefore,
                  contextAfter,
                });
              }
            }

            if (fileMatches > 0) {
              fileMatchCounts.set(path, (fileMatchCounts.get(path) || 0) + fileMatches);
            }
          } catch {}
        },
      );

      if (outputMode === "files") {
        const uniqueFiles = Array.from(new Set(results.map(r => r.path)));
        return { content: uniqueFiles.join("\n") };
      }

      if (outputMode === "count") {
        const counts = Array.from(fileMatchCounts.entries()).map(
          ([path, count]) => `${path}:${count}`,
        );
        return { content: counts.join("\n") };
      }

      const formatted = results.map(r => {
        let output = `${r.path}:${r.lineNumber}:${r.line}`;
        if (contextLines > 0 && (r.contextBefore.length > 0 || r.contextAfter.length > 0)) {
          const before = r.contextBefore.map((line, idx) => {
            const lineNum = r.lineNumber - r.contextBefore.length + idx;
            return `${r.path}:${lineNum}:${line}`;
          });
          const after = r.contextAfter.map((line, idx) => {
            const lineNum = r.lineNumber + 1 + idx;
            return `${r.path}:${lineNum}:${line}`;
          });
          output = [...before, output, ...after].join("\n");
        }
        return output;
      });

      return { content: formatted.join("\n") };
    });
  },
}));
