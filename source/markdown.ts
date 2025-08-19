import chalk from "chalk";
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// @ts-ignore Type mismatch despite this being the recommended way to instantiate marked-terminal
//   as recommended by their README.
marked.use(markedTerminal());

export function renderMarkdown(text: string): string {
  try {
    // marked@12 is typed to possibly be async, but always returns string when async === false.
    // This is fixed in marked@13, but that introduces a rendering bug: https://github.com/mikaelbr/marked-terminal/issues/304
    return marked.parse(text, { async: false }) as string;
  } catch (error) {
    // If markdown parsing fails, return original text
    return text;
  }
}
