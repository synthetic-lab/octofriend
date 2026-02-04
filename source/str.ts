import path from "path";
import os from "os";

export function displayPath(absolutePath: string): string {
  const cwd = process.cwd();
  if (absolutePath.startsWith(cwd + path.sep)) {
    return "./" + path.relative(cwd, absolutePath);
  }
  const home = os.homedir();
  if (absolutePath.startsWith(home + path.sep)) {
    return "~/" + path.relative(home, absolutePath);
  }
  return absolutePath;
}

export function countLines(content: string) {
  return content.split("\n").length;
}

export function numWidth(num: number) {
  return num.toString().length;
}

export function fileExtLanguage(filePath: string) {
  const dotParts = filePath.split(".");
  let language = "txt";
  if (dotParts.length > 1) language = dotParts[dotParts.length - 1];
  return language;
}

export function extractTrim(line: string) {
  let spaceBefore = "";
  let spaceAfter = "";

  const leadingWhitespace = line.match(/(^\s+)/);
  const trailingWhitespace = line.match(/(\s+$)/);

  if (leadingWhitespace) spaceBefore = leadingWhitespace[1];
  if (trailingWhitespace) spaceAfter = trailingWhitespace[1];

  return [spaceBefore, line.trim(), spaceAfter];
}
