import stringWidth from "string-width";

export type WrapResult = {
  wrapped: string;
  originalToWrapped: number[]; // Maps original position -> wrapped position
  wrappedToOriginal: number[]; // Maps wrapped position -> original position (-1 for inserted newlines)
};

/**
 * Hard-wrap text at word boundaries, preserving existing newlines.
 * Returns wrapped text and position mapping for cursor tracking.
 *
 * optional param: firstLineWidth - if provided, the width of the first line.
 *   Useful for text where the first line has non-text content that takes up some width.
 */
export function wrapTextWithMapping(
  text: string,
  width: number,
  firstLineWidth?: number,
): WrapResult {
  if (width <= 0) {
    // Invalid width, return unchanged
    const mapping = Array.from({ length: text.length + 1 }, (_, i) => i);
    return { wrapped: text, originalToWrapped: mapping, wrappedToOriginal: mapping };
  }

  let effectiveWidth = firstLineWidth !== undefined ? firstLineWidth : width;
  let pastFirstLine = false;

  const switchToFullWidth = () => {
    if (!pastFirstLine) {
      pastFirstLine = true;
      effectiveWidth = width;
    }
  };

  const originalToWrapped: number[] = [];
  const wrappedToOriginal: number[] = [];
  let wrapped = "";
  let wrappedPos = 0;
  let originalPos = 0;

  // Split by existing newlines to preserve them
  const paragraphs = text.split("\n");

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
        if (!lineStart && lineWidth + wordWidth >= effectiveWidth) {
          // Word doesn't fit - wrap to new line (soft newline)
          wrapped += "\n";
          wrappedToOriginal[wrappedPos] = -1; // Inserted newline
          wrappedPos++;
          lineWidth = 0;
          lineStart = true;
          switchToFullWidth();
        }

        if (wordWidth >= effectiveWidth) {
          const chars = [...word];
          for (const char of chars) {
            const charWidth = stringWidth(char);

            if (!lineStart && lineWidth + charWidth >= effectiveWidth) {
              wrapped += "\n";
              wrappedToOriginal[wrappedPos] = -1; // Inserted newline
              wrappedPos++;
              lineWidth = 0;
              switchToFullWidth();
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
      wrappedToOriginal[wrappedPos] = originalPos; // Real newline maps to original
      wrapped += "\n";
      wrappedPos++;
      originalPos++;
      switchToFullWidth();
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
  let current = "";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    current += char;

    // End word after whitespace if next char is non-whitespace
    if (/\s/.test(char) && i + 1 < text.length && !/\s/.test(text[i + 1])) {
      words.push(current);
      current = "";
    }
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words;
}
