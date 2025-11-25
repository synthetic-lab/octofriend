import React from "react";
import { Box, Text } from "ink";
import type { Key } from "ink";
import { useColor } from "../theme.ts";

const isWhitespace = (char: string): boolean => /\s/.test(char);

const clampToVimBounds = (pos: number, textLength: number): number => {
  return Math.min(Math.max(0, pos), Math.max(0, textLength - 1));
};

const vimCommandResult = (pos: number, textLength: number) => ({
  consumed: true,
  newCursorPosition: clampToVimBounds(pos, textLength)
});

const vimEarlyExit = (condition: boolean) => {
  if (condition) return { consumed: true };
  return null;
};

const getLineInfo = (text: string, position: number): { lineIndex: number, columnIndex: number } => {
  const lines = text.split('\n');
  let currentPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    if (position >= currentPos && position <= currentPos + lineLength) {
      return {
        lineIndex: i,
        columnIndex: position - currentPos
      };
    }
    currentPos += lineLength + 1; // +1 for the newline
  }

  // If position is at the very end (after last newline), return last line
  return {
    lineIndex: lines.length - 1,
    columnIndex: lines[lines.length - 1]?.length || 0
  };
};

const getLineStart = (text: string, lineIndex: number): number => {
  const lines = text.split('\n');
  let position = 0;

  for (let i = 0; i < lineIndex && i < lines.length; i++) {
    position += lines[i].length + 1; // +1 for the newline
  }

  return position;
};

export function VimModeIndicator({
  vimEnabled,
  vimMode
}: {
  vimEnabled: boolean;
  vimMode: 'NORMAL' | 'INSERT';
}) {
  if (!vimEnabled || vimMode === 'NORMAL') return null;

  const themeColor = useColor();

  return (
    <Box>
      <Text color={themeColor} bold>-- INSERT --</Text>
    </Box>
  );
}

export function useVimKeyHandler(
  vimMode: 'NORMAL' | 'INSERT',
  setVimMode: (mode: 'NORMAL' | 'INSERT') => void
) {
  return {
    handle(
      input: string,
      key: Key,
      cursorPosition: number,
      valueLength: number,
      currentValue: string
    ): { consumed: boolean, newCursorPosition?: number, newValue?: string } {
      if (vimMode === 'INSERT') {
        if (key.escape || (key.ctrl && input === 'c')) {
          // When returning from INSERT to NORMAL, move cursor left to be ON a character
          let newCursorPosition = cursorPosition;
          if (cursorPosition > 0) {
            newCursorPosition = cursorPosition - 1;
          }
          setVimMode('NORMAL');
          return { consumed: true, newCursorPosition };
        }

        if(key.return) {
          return {
            consumed: true,
            newValue: currentValue.slice(0, cursorPosition) + "\n" + currentValue.slice(cursorPosition),
          };
        }

        return { consumed: false };
      }

      if(key.return) return { consumed: false };

      const commands: Record<string, () => { consumed: boolean, newCursorPosition?: number, newValue?: string }> = {
        'i': () => {
          setVimMode('INSERT');
          return { consumed: true };
        },
        'a': () => {
          const newCursorPosition = Math.min(valueLength, cursorPosition + 1);
          setVimMode('INSERT');
          return { consumed: true, newCursorPosition };
        },
        'h': () => {
          if (cursorPosition > 0) {
            return vimCommandResult(cursorPosition - 1, valueLength);
          }
          return vimCommandResult(cursorPosition, valueLength);
        },
        'l': () => {
          // In NORMAL mode, cursor stays ON character, not after
          if (cursorPosition < valueLength - 1) {
            return vimCommandResult(cursorPosition + 1, valueLength);
          }
          return vimCommandResult(cursorPosition, valueLength);
        },
        'k': () => {
          // Move up one line
          const lines = currentValue.split('\n');
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);

          if (currentLineInfo.lineIndex > 0) {
            const targetLineIndex = currentLineInfo.lineIndex - 1;
            const targetLine = lines[targetLineIndex];
            const targetCol = Math.min(currentLineInfo.columnIndex, targetLine.length);
            const newCursorPosition = getLineStart(currentValue, targetLineIndex) + targetCol;
            return vimCommandResult(newCursorPosition, valueLength);
          }

          return vimCommandResult(cursorPosition, valueLength);
        },
        'j': () => {
          // Move down one line
          const lines = currentValue.split('\n');
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);

          if (currentLineInfo.lineIndex < lines.length - 1) {
            const targetLineIndex = currentLineInfo.lineIndex + 1;
            const targetLine = lines[targetLineIndex];
            const targetCol = Math.min(currentLineInfo.columnIndex, targetLine.length);
            const newCursorPosition = getLineStart(currentValue, targetLineIndex) + targetCol;
            return vimCommandResult(newCursorPosition, valueLength);
          }

          return vimCommandResult(cursorPosition, valueLength);
        },
        'o': () => {
          // Create new line below and enter insert mode
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const insertPosition = getLineStart(currentValue, currentLineInfo.lineIndex + 1);

          setVimMode('INSERT');
          return {
            consumed: true,
            newCursorPosition: insertPosition,
            newValue: currentValue.slice(0, insertPosition) + '\n' + currentValue.slice(insertPosition)
          };
        },
        'O': () => {
          // Create new line above and enter insert mode
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const insertPosition = getLineStart(currentValue, currentLineInfo.lineIndex);

          setVimMode('INSERT');
          return {
            consumed: true,
            newCursorPosition: insertPosition,
            newValue: currentValue.slice(0, insertPosition) + '\n' + currentValue.slice(insertPosition)
          };
        },
        'x': () => {
          // Delete character under cursor - position N means ON Nth character
          if (valueLength > 0) {
            const beforeCursor = currentValue.slice(0, cursorPosition);
            const afterCursor = currentValue.slice(cursorPosition + 1);
            const newValue = beforeCursor + afterCursor;

            let newCursorPosition = cursorPosition;
            if (newValue.length === 0) {
              newCursorPosition = 0;
            } else if (cursorPosition >= newValue.length) {
              newCursorPosition = newValue.length - 1;
            }

            return { consumed: true, newValue, newCursorPosition };
          }
          return { consumed: true };
        },
        'w': () => {
          // Move to start of next word
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;

          const currentChar = currentValue[cursorPosition];
          let newCursorPosition: number;

          if (isWhitespace(currentChar)) {
            // On whitespace: find next non-whitespace
            newCursorPosition = cursorPosition;
            while (newCursorPosition < valueLength && /\s/.test(currentValue[newCursorPosition])) {
              newCursorPosition++;
            }
          } else {
            // On word: find end of current word, then start of next word
            let wordEnd = cursorPosition;
            while (wordEnd < valueLength && !/\s/.test(currentValue[wordEnd])) {
              wordEnd++;
            }

            // Skip whitespace to find next word start
            newCursorPosition = wordEnd;
            while (newCursorPosition < valueLength && /\s/.test(currentValue[newCursorPosition])) {
              newCursorPosition++;
            }
          }

          return vimCommandResult(newCursorPosition, valueLength);
        },
        'b': () => {
          // Move to start of previous word
          const earlyExit = vimEarlyExit(cursorPosition === 0);
          if (earlyExit) return earlyExit;

          let wordStart = cursorPosition;
          while (wordStart > 0 && /\s/.test(currentValue[wordStart - 1])) {
            wordStart--;
          }
          while (wordStart > 0 && !/\s/.test(currentValue[wordStart - 1])) {
            wordStart--;
          }

          return vimCommandResult(wordStart, valueLength);
        },
        'e': () => {
          // Move to end of current word (or next word if at word end)
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;

          const currentChar = currentValue[cursorPosition];
          const nextChar = cursorPosition + 1 < valueLength ? currentValue[cursorPosition + 1] : '';
          const atWordEnd = !isWhitespace(currentChar) && (cursorPosition === valueLength - 1 || isWhitespace(nextChar));

          let wordEnd: number;

          if (atWordEnd) {
            // Already at word end, find next word and go to its end
            wordEnd = cursorPosition + 1;
            while (wordEnd < valueLength && /\s/.test(currentValue[wordEnd])) {
              wordEnd++;
            }
            while (wordEnd < valueLength && !/\s/.test(currentValue[wordEnd])) {
              wordEnd++;
            }
          } else {
            // Go to end of current word
            wordEnd = cursorPosition;
            while (wordEnd < valueLength && /\s/.test(currentValue[wordEnd])) {
              wordEnd++;
            }
            while (wordEnd < valueLength && !/\s/.test(currentValue[wordEnd])) {
              wordEnd++;
            }
          }

          // e goes to last character of word, step back from emacs meta-f position
          const vimPos = Math.max(0, wordEnd - 1);
          return vimCommandResult(vimPos, valueLength);
        },
        '0': () => {
          return { consumed: true, newCursorPosition: 0 };
        },
        '$': () => {
          // In NORMAL mode, cursor goes ON last character, not after
          const lastCharPos = Math.max(0, valueLength - 1);
          return { consumed: true, newCursorPosition: lastCharPos };
        },
        '^': () => {
          let newCursorPosition = 0;

          while (newCursorPosition < valueLength && isWhitespace(currentValue[newCursorPosition])) {
            newCursorPosition++;
          }

          return { consumed: true, newCursorPosition };
        },
        'I': () => {
          setVimMode('INSERT');
          return { consumed: true, newCursorPosition: 0 };
        },
        'A': () => {
          // In INSERT mode, cursor can be after last character
          setVimMode('INSERT');
          return { consumed: true, newCursorPosition: valueLength };
        },
      };

      // Arrow keys redirect to vim commands
      if (key.leftArrow) {
        return commands['h']();
      }

      if (key.rightArrow) {
        return commands['l']();
      }

      if (key.upArrow) {
        return commands['k']();
      }

      if (key.downArrow) {
        return commands['j']();
      }

      // Check character commands
      if (input in commands) {
        return commands[input]();
      }

      // NORMAL mode: ignore unhandled keys
      return { consumed: true };
    }
  };
}
