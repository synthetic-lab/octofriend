import type { Key } from "ink";

const isWhitespace = (char: string): boolean => /\s/.test(char);

type EmacsResult = {
  consumed: boolean;
  newCursorPosition?: number;
  newValue?: string;
};

export function useEmacsKeyHandler() {
  return {
    handle(
      input: string,
      key: Key,
      cursorPosition: number,
      valueLength: number,
      currentValue: string,
      showCursor: boolean,
    ): EmacsResult {
      // Ctrl+A: Beginning of line
      if (key.ctrl && input === "a") {
        return { consumed: true, newCursorPosition: 0 };
      }

      // Ctrl+E: End of line
      if (key.ctrl && input === "e") {
        return { consumed: true, newCursorPosition: valueLength };
      }

      // Ctrl+B: Back one character
      if (key.ctrl && input === "b") {
        if (showCursor && cursorPosition > 0) {
          return { consumed: true, newCursorPosition: cursorPosition - 1 };
        }
        return { consumed: true };
      }

      // Ctrl+F: Forward one character
      if (key.ctrl && input === "f") {
        if (showCursor && cursorPosition < valueLength) {
          return { consumed: true, newCursorPosition: cursorPosition + 1 };
        }
        return { consumed: true };
      }

      // Meta+B: Back one word
      if (key.meta && input === "b") {
        if (showCursor && cursorPosition > 0) {
          let wordStart = cursorPosition;
          // Skip whitespace
          while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }
          // Skip word characters
          while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }
          return { consumed: true, newCursorPosition: wordStart };
        }
        return { consumed: true };
      }

      // Meta+F: Forward one word
      if (key.meta && input === "f") {
        if (showCursor && cursorPosition < valueLength) {
          let wordEnd = cursorPosition;
          // Skip whitespace
          while (wordEnd < valueLength && isWhitespace(currentValue[wordEnd])) {
            wordEnd++;
          }
          // Skip word characters
          while (wordEnd < valueLength && !isWhitespace(currentValue[wordEnd])) {
            wordEnd++;
          }
          return { consumed: true, newCursorPosition: wordEnd };
        }
        return { consumed: true };
      }

      // Ctrl+W: Delete word backward
      if (key.ctrl && input === "w") {
        if (cursorPosition > 0) {
          let wordStart = cursorPosition;
          // Skip whitespace
          while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }
          // Skip word characters
          while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }
          const newValue = currentValue.slice(0, wordStart) + currentValue.slice(cursorPosition);
          return { consumed: true, newCursorPosition: wordStart, newValue };
        }
        return { consumed: true };
      }

      // Ctrl+H: Delete character backward (same as backspace)
      if (key.ctrl && input === "h") {
        if (cursorPosition > 0) {
          const newValue =
            currentValue.slice(0, cursorPosition - 1) + currentValue.slice(cursorPosition);
          return { consumed: true, newCursorPosition: cursorPosition - 1, newValue };
        }
        return { consumed: true };
      }

      // Ctrl+D: Delete character forward
      if (key.ctrl && input === "d") {
        if (cursorPosition < valueLength) {
          const newValue =
            currentValue.slice(0, cursorPosition) + currentValue.slice(cursorPosition + 1);
          return { consumed: true, newValue };
        }
        return { consumed: true };
      }

      // Meta+D: Delete word forward
      if (key.meta && input === "d") {
        if (cursorPosition < valueLength) {
          let wordEnd = cursorPosition;
          // Skip whitespace
          while (wordEnd < valueLength && isWhitespace(currentValue[wordEnd])) {
            wordEnd++;
          }
          // Skip word characters
          while (wordEnd < valueLength && !isWhitespace(currentValue[wordEnd])) {
            wordEnd++;
          }
          const newValue = currentValue.slice(0, cursorPosition) + currentValue.slice(wordEnd);
          return { consumed: true, newValue };
        }
        return { consumed: true };
      }

      // Ctrl+K: Kill to end of line
      if (key.ctrl && input === "k") {
        const newValue = currentValue.slice(0, cursorPosition);
        return { consumed: true, newValue };
      }

      // Ctrl+U: Kill to beginning of line
      if (key.ctrl && input === "u") {
        const newValue = currentValue.slice(cursorPosition);
        return { consumed: true, newCursorPosition: 0, newValue };
      }

      // Not an emacs binding
      return { consumed: false };
    },
  };
}
