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

  const contentLimit = MAX_PREVIEW_CHARACTERS - ELLIPSIS.length;
  if (clean.length <= contentLimit) return `${clean}${ELLIPSIS}`;

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
