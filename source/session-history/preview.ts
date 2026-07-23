export const MAX_PREVIEW_CHARACTERS = 50;
const MINIMUM_SENTENCE_FILL_RATIO = 0.6;
const ELLIPSIS = "…";

const wordSegmenter = new Intl.Segmenter(undefined, {
  granularity: "word",
});

const sentenceSegmenter = new Intl.Segmenter(undefined, {
  granularity: "sentence",
});

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

// Shortens text at a natural (as possible) boundary within the MAX_PREVEW_CHARACTERS limit.
export function excerpt(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean === "") return "";

  const contentLimit = MAX_PREVIEW_CHARACTERS - ELLIPSIS.length;
  if (clean.length <= contentLimit) return `${clean}${ELLIPSIS}`;

  const minimumEnd = Math.ceil(MAX_PREVIEW_CHARACTERS * MINIMUM_SENTENCE_FILL_RATIO);

  let sentenceEnd: number | undefined;
  for (const sentence of sentenceSegmenter.segment(clean)) {
    const end = sentence.index + sentence.segment.trimEnd().length;
    if (end > contentLimit) break;
    if (end >= minimumEnd) sentenceEnd = end;
  }

  let wordEnd: number | undefined;
  for (const word of wordSegmenter.segment(clean)) {
    const end = word.index + word.segment.length;
    if (end > contentLimit) break;
    if (word.isWordLike || wordEnd != null) wordEnd = end;
  }
  if (wordEnd != null && wordEnd < minimumEnd) wordEnd = undefined;

  let hardEnd = 0;
  for (const grapheme of graphemeSegmenter.segment(clean)) {
    const end = grapheme.index + grapheme.segment.length;
    if (end > contentLimit) break;
    hardEnd = end;
  }

  const end = sentenceEnd ?? wordEnd ?? hardEnd;
  const result = clean.slice(0, end).trimEnd();
  return `${result}${ELLIPSIS}`;
}
