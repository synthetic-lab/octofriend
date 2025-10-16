import { t } from "structural";
import parseGitDiff from "parse-git-diff";
import { getAllCommits, getCommitDiff, getFileContentsBeforeAfter } from "./git.ts";
import edits from "../source/tools/tool-defs/edit.ts";
import { parseLines } from "./parse.ts";
import { asynctryexpr } from "../source/tryexpr.ts";

export type Diff = {
  edit: t.GetType<typeof edits.DiffEdit>,
  file: string,
};

export async function* genDiffs(gitDir: string): AsyncGenerator<Diff> {
  for await(const sha of getAllCommits(gitDir)) {
    const [ err, diff ] = await asynctryexpr(async () => await getCommitDiff(sha, gitDir));
    if(err) continue;
    const parsed = parseGitDiff(diff);
    if(parsed.type !== "GitDiff") continue;
    for(const file of parsed.files) {
      if(file.type !== "ChangedFile") continue;
      const [ err, result ] = await asynctryexpr(async () => {
        return await getFileContentsBeforeAfter(file.path, sha, gitDir);
      });
      if(err) continue;
      const [ before, after ] = result;
      const beforeLines = parseLines(before);
      const afterLines = parseLines(after);

      for(const chunk of file.chunks) {
        if(chunk.type !== "Chunk") continue;
        const searchLines = getFromRange(beforeLines, chunk.fromFileRange);
        const replaceLines = getFromRange(afterLines, chunk.toFileRange);

        const edit: t.GetType<typeof edits.DiffEdit> = {
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
