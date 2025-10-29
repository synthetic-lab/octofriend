import { t } from "structural";
import path from "path";
import fs from "fs/promises";
import edits from "../../source/tools/tool-defs/edit.ts";
import { fileURLToPath } from "url";
import { fixEditPrompt, DiffApplySuccess, DiffApplyFailure } from "../../source/prompts/autofix-prompts.ts";
import { parseLines } from "../parse.ts";
import { genDiffs, Diff } from "../generate-edits.ts";
import { pickRandom, randomIndex, oneToN, percentChance, coinFlip } from "../random.ts";
import { cutIndex, insertAt } from "../str.ts";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TRAIN_PATH = path.join(__dirname, "unfat/output/data/train.jsonl");
const EVAL_PATH = path.join(__dirname, "unfat/output/data/eval.jsonl");
const MAX_NUM_BREAKS = 5;
const MAX_BREAK_ATTEMPTS = 100;
const AMBIGUOUS_PERCENT = 0.1;
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
  let ambiguousCount = 0;
  for await(const edit of genDiffs(path.join(repo, ".git"))) {
    if(edit.file.length > (1024 * 48)) continue;

    try {
      const response = (() => {
        if(percentChance(AMBIGUOUS_PERCENT)) {
          const messages = ambiguousEditMessages(edit);
          ambiguousCount++;
          return messages;
        }
        return breakEditMessages(edit);
      })();

      const messages = [
        {
          role: "user",
          content: fixEditPrompt(response.diff),
        },
        {
          role: "assistant",
          content: JSON.stringify(response.response),
        },
      ];
      let outputPath = TRAIN_PATH;
      if(percentChance(EVAL_PERCENT)) outputPath = EVAL_PATH;
      await fs.appendFile(outputPath, JSON.stringify({ messages }) + "\n", "utf8");
      successCount++;
    } catch {
      skippedBreaks++;
    }
  }

  console.log(
    `Finished generating; failed to break ${skippedBreaks} edits, successfully broke ${successCount} edits.`
  );
  console.log(
    `Of those successes, ${ambiguousCount} were successfully set to ambiguous.`
  );
}

type BreakResponse = {
  diff: Diff,
  response: t.GetType<typeof DiffApplySuccess> | t.GetType<typeof DiffApplyFailure>,
};
function ambiguousEditMessages(diff: Diff): BreakResponse {
  if(coinFlip()) return dupeAmbiguous(diff);
  else return cutAmbiguous(diff);
}

function insertIndex<T>(arr: T[], index: number, item: T) {
  if(index === 0) return [ item ].concat(arr);
  if(index === arr.length - 1) return arr.concat([ item ]);
  return arr.slice(0, index).concat([ item ]).concat(arr.slice(index));
}

function dupeAmbiguous(diff: Diff): BreakResponse {
  const lines = parseLines(diff.file);
  const lineIndex = randomIndex(lines);
  const newFile = insertIndex(lines, lineIndex, diff.edit.search);

  return {
    diff: {
      file: newFile.join("\n"),
      edit: diff.edit,
    },
    response: { success: false },
  };
}

function moreThanOneMatch(file: string, search: string) {
  const index = file.indexOf(search);
  if(index < 0) return false;

  const rest = file.slice(index);
  return rest.indexOf(search) >= 0;
}

function cutAmbiguous(diff: Diff): BreakResponse {
  let cut = diff.edit.search;

  while(moreThanOneMatch(diff.file, cut) && cut.length > 1) {
    if(coinFlip()) cut = cut.slice(1);
    else cut = cut.slice(0, cut.length - 1);
  }

  if(!moreThanOneMatch(diff.file, cut)) {
    throw new Error("Couldn't cut search string to the point of ambiguity");
  }

  return {
    diff: {
      file: diff.file,
      edit: {
        search: cut,
        replace: diff.edit.replace,
      },
    },
    response: { success: false },
  };
}

function breakEditMessages(edit: Diff): BreakResponse {
  const numBreaks = oneToN(MAX_NUM_BREAKS);
  let brokenEdit: Diff = { file: edit.file, edit: { ...edit.edit } };
  for(let i = 0; i < numBreaks; i++) {
    brokenEdit = {
      file: edit.file,
      edit: {
        search: breakSearchStringRandomly(brokenEdit.edit, brokenEdit.file),
        replace: edit.edit.replace,
      },
    };
  }

  return {
    diff: brokenEdit,
    response: {
      success: true,
      search: edit.edit.search,
    },
  };
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
