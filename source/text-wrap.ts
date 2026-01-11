import stringWidth from 'string-width';

export type WrapResult = {
  wrapped: string;
  originalToWrapped: number[];  // Maps original position -> wrapped position
  wrappedToOriginal: number[];  // Maps wrapped position -> original position (-1 for inserted newlines)
};

/**
 * Hard-wrap text at word boundaries, preserving existing newlines.
 * Returns wrapped text and position mapping for cursor tracking.
 */
export function wrapTextWithMapping(text: string, width: number): WrapResult {
  if (width <= 0) {
    // Invalid width, return unchanged
    const mapping = Array.from({ length: text.length + 1 }, (_, i) => i);
    return { wrapped: text, originalToWrapped: mapping, wrappedToOriginal: mapping };
  }

  const originalToWrapped: number[] = [];
  const wrappedToOriginal: number[] = [];
  let wrapped = '';
  let wrappedPos = 0;
  let originalPos = 0;

  // Split by existing newlines to preserve them
  const paragraphs = text.split('\n');

  for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
    const paragraph = paragraphs[pIndex];

    if (paragraph.length === 0) {
      // Empty paragraph - just map the position
      originalToWrapped[originalPos] = wrappedPos;
    } else {
      // Wrap this paragraph
      const words = splitIntoWords(paragraph);
      let lineWidth = 0;
      let lineStart = true;

      for (const word of words) {
        const wordWidth = stringWidth(word);

        // Check if word fits on current line (leave 1 cell for cursor)
        if (!lineStart && lineWidth + wordWidth >= width) {
          // Word doesn't fit - wrap to new line (soft newline)
          wrapped += '\n';
          wrappedToOriginal[wrappedPos] = -1;  // Inserted newline
          wrappedPos++;
          lineWidth = 0;
          lineStart = true;
        }

        // Handle words longer than width (hard-break them)
        if (wordWidth >= width) {
          const chars = [...word];
          for (const char of chars) {
            const charWidth = stringWidth(char);

            if (!lineStart && lineWidth + charWidth >= width) {
              wrapped += '\n';
              wrappedToOriginal[wrappedPos] = -1;  // Inserted newline
              wrappedPos++;
              lineWidth = 0;
            }

            originalToWrapped[originalPos] = wrappedPos;
            wrappedToOriginal[wrappedPos] = originalPos;
            wrapped += char;
            wrappedPos++;
            originalPos++;
            lineWidth += charWidth;
            lineStart = false;
          }
        } else {
          // Add word normally
          for (const char of word) {
            originalToWrapped[originalPos] = wrappedPos;
            wrappedToOriginal[wrappedPos] = originalPos;
            wrapped += char;
            wrappedPos++;
            originalPos++;
          }
          lineWidth += wordWidth;
          lineStart = false;
        }
      }
    }

    // Add newline between paragraphs (except after last)
    if (pIndex < paragraphs.length - 1) {
      originalToWrapped[originalPos] = wrappedPos;
      wrappedToOriginal[wrappedPos] = originalPos;  // Real newline maps to original
      wrapped += '\n';
      wrappedPos++;
      originalPos++;
    }
  }

  // Map the end position (cursor can be at text.length)
  originalToWrapped[originalPos] = wrappedPos;
  wrappedToOriginal[wrappedPos] = originalPos;

  return { wrapped, originalToWrapped, wrappedToOriginal };
}

/**
 * Split text into words, preserving spaces as part of words.
 * "hello world  foo" -> ["hello ", "world  ", "foo"]
 */
function splitIntoWords(text: string): string[] {
  const words: string[] = [];
  let current = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;

    // End word after whitespace if next char is non-whitespace
    if (/\s/.test(char) && i + 1 < text.length && !/\s/.test(text[i + 1])) {
      words.push(current);
      current = '';
    }
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}
