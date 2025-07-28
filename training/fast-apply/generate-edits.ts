import { t } from "structural";
import path from "path";
import fs from "fs/promises";
import parseGitDiff from "parse-git-diff";
import edits from "../../source/tools/tool-defs/edit";
import { getAllCommits, getCommitDiff, getFileContentsBeforeAfter } from "./git";
import { fileURLToPath } from "url";
import { fixPrompt } from "../../source/diffapply";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRAIN_PATH = path.join(__dirname, "unfat/output/data/train.jsonl");
const EVAL_PATH = path.join(__dirname, "unfat/output/data/eval.jsonl");
const MAX_NUM_BREAKS = 5;
const MAX_BREAK_ATTEMPTS = 1000;
const EVAL_PERCENT = 0.1;

const REPOS_DIR = path.join(path.dirname(__dirname), "repos");

async function main() {
  try {
    await fs.rm(TRAIN_PATH);
    await fs.rm(EVAL_PATH);
  } catch {}
  await fs.mkdir(path.dirname(TRAIN_PATH), { recursive: true });
  await fs.writeFile(TRAIN_PATH, "");
  await fs.writeFile(EVAL_PATH, "");

  console.log("Generating edits for this repo");
  await genEditsForRepo(".");

  const repos = await fs.readdir(REPOS_DIR);
  for(const repo of repos) {
    console.log("Generating edits for", repo);
    await genEditsForRepo(path.join(REPOS_DIR, repo));
  }
}

async function genEditsForRepo(repo: string) {
  let skippedBreaks = 0;
  let successCount = 0;
  for await(const edit of getEdits(path.join(repo, ".git"))) {
    try {
      const numBreaks = Math.floor(Math.random() * MAX_NUM_BREAKS);
      let brokenEdit = { file: edit.file, edit: { ...edit.edit } };
      for(let i = 0; i < numBreaks; i++) {
        brokenEdit = {
          file: edit.file,
          edit: {
            type: "diff",
            search: breakSearchStringRandomly(brokenEdit.edit, brokenEdit.file),
            replace: edit.edit.replace,
          },
        };
      }

      const messages = [
        {
          role: "user",
          content: fixPrompt(brokenEdit),
        },
        {
          role: "assistant",
          content: JSON.stringify(edit.edit),
        },
      ];
      let outputPath = TRAIN_PATH;
      if(Math.random() < EVAL_PERCENT) {
        outputPath = EVAL_PATH;
      }
      await fs.appendFile(outputPath, JSON.stringify({ messages }) + "\n", "utf8");
      successCount++;
    } catch {
      skippedBreaks++;
    }
  }

  console.log(
    `Finished generating; failed to break ${skippedBreaks} edits, successfully broke ${successCount} edits`
  );
}

const breakFns: Array<(search: string) => string> = [];
function defineBreak(cb: (search: string) => string) {
  breakFns.push(cb);
}

const SPECIAL_CHARS = [
  " ", "{", "}", "[", "]", "\t", "\n", "(", ")", "$", "@", ",", ";", ":", ".", "\\", "\"", "'", "<",
  ">", "&", "|", "-", "+", "#", "/", "*",
];

for(const char of SPECIAL_CHARS) {
  defineBreak(deleteChar(char));
  defineBreak(doubleChar(char));
}

defineBreak(search => {
  if(search.length === 0) return search;
  return cutIndex(search, randomIndex(search));
});

defineBreak(search => insertAt(search, randomIndex(search), " "));
defineBreak(search => insertAt(search, randomIndex(search), "\t"));
defineBreak(search => search.replace(/ +/g, "\t"));
defineBreak(search => search.replace(/\t/g, "  "));
defineBreak(search => {
  const lines = parseLines(search);
  const index = randomIndex(lines);
  return lines.slice(0, index).concat([""]).concat(lines.slice(index)).join("\n");
});

function doubleChar(char: string) {
  return (search: string) => {
    const indexes = findChar(search, char);
    if(indexes.length === 0) return search;
    return insertAt(search, pickRandom(indexes), char);
  };
}

function deleteChar(char: string) {
  return (search: string) => {
    const indexes = findChar(search, char);
    if(indexes.length === 0) return search;
    return cutIndex(search, pickRandom(indexes));
  };
}

function findChar(str: string, searchChar: string) {
  const indices: number[] = [];
  for(let i = 0; i < str.length; i++) {
    const char = str[i];
    if(char === searchChar) indices.push(i);
  }
  return indices;
}

function breakSearchStringRandomly(edit: t.GetType<typeof edits.DiffEdit>, file: string) {
  const breaker = pickRandom(breakFns);
  let result = breaker(edit.search);
  if(!file.includes(result)) return result;

  for(let i = 0; i < MAX_BREAK_ATTEMPTS; i++) {
    const breaker = pickRandom(breakFns);
    result = breaker(edit.search);
    if(!file.includes(result)) return result;
  }

  throw new Error(`Couldn't break search string after ${MAX_BREAK_ATTEMPTS} attempts`);
}

function insertAt(str: string, index: number, add: string) {
  return str.slice(0, index) + add + str.slice(index);
}

function cutIndex(str: string, index: number) {
  return str.slice(0, index) + str.slice(index + 1);
}

function pickRandom<T>(arr: Array<T>): T {
  const index = randomIndex(arr);
  return arr[index];
}

function randomIndex(item: { length: number }) {
  return Math.floor(Math.random() * item.length);
}

async function* getEdits(gitDir: string) {
  for await(const sha of getAllCommits(gitDir)) {
    const [ err, diff ] = await tryexpr(async () => await getCommitDiff(sha, gitDir));
    if(err) continue;
    const parsed = parseGitDiff(diff);
    if(parsed.type !== "GitDiff") continue;
    for(const file of parsed.files) {
      if(file.type !== "ChangedFile") continue;
      const [ err, result ] = await tryexpr(async () => {
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
          type: "diff",
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

async function tryexpr<T>(cb: () => Promise<T>): Promise<[ Error, null ] | [ null, T ]> {
  try {
    const val = await cb();
    return [ null, val ];
  } catch(e) {
    if(e instanceof Error) return [ e, null ];
    return [ new Error(`${e}`), null ];
  }
}

function getFromRange(lines: string[], range: { start: number, lines: number }) {
  return lines.slice(range.start - 1, range.start - 1 + range.lines);
}

function parseLines(str: string): string[] {
  if(str.length === 0) return [];

  let line: string[] = [];
  const lines: string[] = [];

  for(const char of str) {
    if(char === "\n") {
      lines.push(line.join(""));
      line = [];
    }
    else {
      line.push(char);
    }
  }

  if(line.length > 0) lines.push(line.join(""));

  return lines;
}

main();
