import { t } from "structural";
import parseGitDiff from "parse-git-diff";
import { getAllCommits, getCommitDiff, getFileContentsBeforeAfter } from "./git.ts";
import { DiffEditSchema } from "../source/tools/tool-defs/edit.ts";
import { parseLines } from "./parse.ts";
import { attempt } from "../source/libocto/result.ts";

export type Diff = {
  edit: t.GetType<typeof DiffEditSchema>,
  file: string,
};

export async function* genDiffs(gitDir: string): AsyncGenerator<Diff> {
  for await(const sha of getAllCommits(gitDir)) {
    const diff = await attempt("Failed to get commit diff", () => getCommitDiff(sha, gitDir));
    if(!diff.success) continue;
    const parsed = parseGitDiff(diff.data);
    if(parsed.type !== "GitDiff") continue;
    for(const file of parsed.files) {
      if(file.type !== "ChangedFile") continue;
      const contents = await attempt("Failed to get file contents", () => {
        return getFileContentsBeforeAfter(file.path, sha, gitDir);
      });
      if(!contents.success) continue;
      const [ before, after ] = contents.data;
      const beforeLines = parseLines(before);
      const afterLines = parseLines(after);

      for(const chunk of file.chunks) {
        if(chunk.type !== "Chunk") continue;
        const searchLines = getFromRange(beforeLines, chunk.fromFileRange);
        const replaceLines = getFromRange(afterLines, chunk.toFileRange);

        const edit: t.GetType<typeof DiffEditSchema> = {
          search: searchLines.join("\n"),
          replace: replaceLines.join("\n"),
        };
        yield {
          edit,
          file: before,
        };
      }
    }
  }
}

function getFromRange(lines: string[], range: { start: number, lines: number }) {
  return lines.slice(range.start - 1, range.start - 1 + range.lines);
}
