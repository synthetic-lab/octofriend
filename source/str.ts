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

export const LINE_SPLIT_REGEX = /\r\n|\r|\n/;

export const MAX_PREVIEW_CHARACTERS = 50;
const ELLIPSIS = "…";

const wordSegmenter = new Intl.Segmenter(undefined, {
  granularity: "word",
});

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

// Shortens text within the MAX_PREVEW_CHARACTERS limit at a natural word boundary.
export function excerpt(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean === "") return "";
  if (clean.length <= MAX_PREVIEW_CHARACTERS) return clean;

  const contentLimit = MAX_PREVIEW_CHARACTERS - ELLIPSIS.length;

  let wordEnd: number | undefined;
  for (const word of wordSegmenter.segment(clean)) {
    const end = word.index + word.segment.length;
    if (end > contentLimit) break;
    if (word.isWordLike || wordEnd != null) wordEnd = end;
  }

  let hardEnd = 0;
  for (const grapheme of graphemeSegmenter.segment(clean)) {
    const end = grapheme.index + grapheme.segment.length;
    if (end > contentLimit) break;
    hardEnd = end;
  }

  const end = wordEnd ?? hardEnd;
  const result = clean.slice(0, end).trimEnd();
  return `${result}${ELLIPSIS}`;
}
