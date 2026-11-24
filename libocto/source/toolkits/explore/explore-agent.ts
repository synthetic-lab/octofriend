import { prompt } from "../../system-prompt.ts";
import * as glob from "../glob/index.ts";
import * as grep from "../grep/index.ts";
import * as list from "../list/index.ts";
import * as partialRead from "../partial-read/index.ts";
import * as read from "../read/index.ts";

export const exploreSystemPrompt = prompt.declare(async () => {
  return `
Explore the filesystem to answer the task assigned by the parent agent. Your purpose is to
search through files whose relevance may be unclear, identify the relevant material, and
summarize it for the parent.

Use filenames, directory structure, and content searches to find candidates, then inspect
their contents to determine which ones matter to the task.

Return a concise summary addressing the assigned task, with paths to the relevant files and
line references when useful. Select the findings the parent needs rather than reporting
everything you discovered. Omit irrelevant files and a narration of your search process.
Mention unresolved questions only when they affect the task.
`.trim();
});

export const exploreAgent = {
  systemPrompt: exploreSystemPrompt,
  tools: {
    read: read.toolkit,
    "partial-read": partialRead.toolkit,
    list: list.toolkit,
    grep: grep.toolkit,
    glob: glob.toolkit,
  },
  agents: {},
};
