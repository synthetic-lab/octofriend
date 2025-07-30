import { t } from "structural";
import path from "path";
import fs from "fs/promises";
import edits from "../../source/tools/tool-defs/edit.ts";
import { fileURLToPath } from "url";
import { fixEditPrompt } from "../../source/autofix-prompts.ts";
import { parseLines } from "../parse.ts";
import { genDiffs } from "../generate-edits.ts";
import { pickRandom, randomIndex } from "../random.ts";
import { cutIndex, insertAt } from "../str.ts";
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
  for await(const edit of genDiffs(path.join(repo, ".git"))) {
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
          content: fixEditPrompt(brokenEdit),
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

main();
