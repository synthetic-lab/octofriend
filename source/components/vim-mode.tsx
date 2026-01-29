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
  newCursorPosition: clampToVimBounds(pos, textLength),
});

const vimEarlyExit = (condition: boolean) => {
  if (condition) return { consumed: true };
  return null;
};

const getLineInfo = (
  text: string,
  position: number,
): { lineIndex: number; columnIndex: number } => {
  const lines = text.split("\n");
  let currentPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    if (position >= currentPos && position <= currentPos + lineLength) {
      return {
        lineIndex: i,
        columnIndex: position - currentPos,
      };
    }
    currentPos += lineLength + 1; // +1 for the newline
  }

  // If position is at the very end (after last newline), return last line
  return {
    lineIndex: lines.length - 1,
    columnIndex: lines[lines.length - 1]?.length || 0,
  };
};

const getLineStart = (text: string, lineIndex: number): number => {
  const lines = text.split("\n");
  let position = 0;

  for (let i = 0; i < lineIndex && i < lines.length; i++) {
    position += lines[i].length + 1; // +1 for the newline
  }

  return position;
};

const getLineEnd = (text: string, lineIndex: number): number => {
  const lineStart = getLineStart(text, lineIndex);
  const lines = text.split("\n");
  const lineLength = lines[lineIndex]?.length || 0;
  return lineStart + Math.max(0, lineLength - 1);
};

const getLineText = (text: string, lineIndex: number): string => {
  const lines = text.split("\n");
  return lines[lineIndex] || "";
};

const getLineInsertEnd = (text: string, lineIndex: number): number => {
  const lineStart = getLineStart(text, lineIndex);
  const lineLength = getLineText(text, lineIndex).length;
  return lineStart + lineLength;
};

const getTargetPosition = (text: string, lineIndex: number, columnIndex: number): number => {
  const line = getLineText(text, lineIndex);
  const targetCol = line.length === 0 ? 0 : Math.min(columnIndex, line.length - 1);
  return getLineStart(text, lineIndex) + targetCol;
};

const getFirstNonWhitespacePosition = (text: string, lineIndex: number): number => {
  const lineStart = getLineStart(text, lineIndex);
  const lineEnd = getLineInsertEnd(text, lineIndex);

  let position = lineStart;

  while (position < lineEnd && isWhitespace(text[position])) {
    position++;
  }

  return position;
};

const getLineRange = (text: string, cursorPosition: number): { start: number; end: number } => {
  const currentLineInfo = getLineInfo(text, cursorPosition);
  const start = getLineStart(text, currentLineInfo.lineIndex);
  const lines = text.split("\n");
  const line = getLineText(text, currentLineInfo.lineIndex);
  let end = start + line.length;
  if (currentLineInfo.lineIndex < lines.length - 1) {
    end += 1; // Include the newline character
  }
  return { start, end };
};

type Motion = (text: string, cursorPosition: number) => { start: number; end: number };

type Operator = (
  text: string,
  range: { start: number; end: number },
  motionChar?: string,
) => {
  newText: string;
  newCursorPosition?: number;
  enterInsertMode?: boolean;
};

type PendingCommand = {
  operator: Operator;
  operatorChar: string;
};

type TextState = {
  text: string;
  cursorPosition: number;
};

const motions: Record<string, Motion> = {
  w: (text, cursorPosition) => {
    const textLength = text.length;
    if (cursorPosition >= textLength) {
      return { start: cursorPosition, end: cursorPosition };
    }

    const currentChar = text[cursorPosition];
    let endPosition: number;

    if (isWhitespace(currentChar)) {
      endPosition = cursorPosition;
      while (endPosition < textLength && isWhitespace(text[endPosition])) {
        endPosition++;
      }
    } else {
      let wordEnd = cursorPosition;
      while (wordEnd < textLength && !isWhitespace(text[wordEnd])) {
        wordEnd++;
      }
      endPosition = wordEnd;
      while (endPosition < textLength && isWhitespace(text[endPosition])) {
        endPosition++;
      }
    }

    return { start: cursorPosition, end: endPosition };
  },
  b: (text, cursorPosition) => {
    if (cursorPosition === 0) {
      return { start: 0, end: 0 };
    }

    let start = cursorPosition;
    while (start > 0 && isWhitespace(text[start - 1])) {
      start--;
    }
    while (start > 0 && !isWhitespace(text[start - 1])) {
      start--;
    }

    return { start: start, end: cursorPosition };
  },
  e: (text, cursorPosition) => {
    const textLength = text.length;
    const currentChar = text[cursorPosition];
    const nextChar = cursorPosition + 1 < textLength ? text[cursorPosition + 1] : "";
    const atWordEnd =
      !isWhitespace(currentChar) && (cursorPosition === textLength - 1 || isWhitespace(nextChar));
    let endPos: number;

    if (atWordEnd) {
      endPos = cursorPosition + 1;
      while (endPos < textLength && isWhitespace(text[endPos])) {
        endPos++;
      }
      while (endPos < textLength && !isWhitespace(text[endPos])) {
        endPos++;
      }
    } else {
      endPos = cursorPosition;
      while (endPos < textLength && isWhitespace(text[endPos])) {
        endPos++;
      }
      while (endPos < textLength && !isWhitespace(text[endPos])) {
        endPos++;
      }
    }

    const vimEndPos = Math.max(0, endPos - 1);
    return { start: cursorPosition, end: vimEndPos + 1 };
  },
  "0": (text, cursorPosition) => {
    const currentLineInfo = getLineInfo(text, cursorPosition);
    const lineStart = getLineStart(text, currentLineInfo.lineIndex);
    return { start: lineStart, end: cursorPosition };
  },
  $: (text, cursorPosition) => {
    const lastCharPos = Math.max(0, text.length - 1);
    return { start: cursorPosition, end: lastCharPos + 1 };
  },
  "^": (text, cursorPosition) => {
    const currentLineInfo = getLineInfo(text, cursorPosition);
    const position = getFirstNonWhitespacePosition(text, currentLineInfo.lineIndex);
    return { start: cursorPosition, end: position };
  },
};

const operators: Record<string, Operator> = {
  d: (text, { start, end }) => {
    const actualEnd = Math.min(end, text.length);
    const actualStart = Math.min(start, actualEnd);
    const newText = text.slice(0, actualStart) + text.slice(actualEnd);
    let newCursorPosition = actualStart;
    if (newText.length === 0) {
      newCursorPosition = 0;
    } else if (newCursorPosition >= newText.length) {
      newCursorPosition = newText.length - 1;
    }
    return { newText, newCursorPosition };
  },
  c: (text, { start, end }, motionChar) => {
    let actualEnd = Math.min(end, text.length);
    const actualStart = Math.min(start, actualEnd);

    // For change operator with word motions (cw), trim trailing whitespace (like ce behavior in vim)
    if (motionChar === "w" || motionChar === "e") {
      let trimmedEnd = actualEnd;
      for (; trimmedEnd > actualStart; trimmedEnd--) {
        const char = text[trimmedEnd - 1];
        if (char === "\n" || char === "\r") {
          continue;
        }
        if (!isWhitespace(char)) break;
      }
      actualEnd = trimmedEnd;
    }

    const newText = text.slice(0, actualStart) + text.slice(actualEnd);
    let newCursorPosition = actualStart;
    if (newCursorPosition > newText.length) {
      newCursorPosition = newText.length;
    }
    return { newText, newCursorPosition, enterInsertMode: true };
  },
};

export function VimModeIndicator({
  vimEnabled,
  vimMode,
}: {
  vimEnabled: boolean;
  vimMode: "NORMAL" | "INSERT";
}) {
  if (!vimEnabled || vimMode === "NORMAL") return null;

  const themeColor = useColor();

  return (
    <Box>
      <Text color={themeColor} bold>
        -- INSERT --
      </Text>
    </Box>
  );
}

export function useVimKeyHandler(
  vimMode: "NORMAL" | "INSERT",
  setVimMode: (mode: "NORMAL" | "INSERT") => void,
) {
  const pendingCommandRef = React.useRef<PendingCommand | null>(null);
  const undoStackRef = React.useRef<TextState[]>([]);
  const redoStackRef = React.useRef<TextState[]>([]);
  const insertStartStateRef = React.useRef<TextState | null>(null);

  const saveState = (text: string, cursorPosition: number) => {
    undoStackRef.current.push({ text, cursorPosition });
    redoStackRef.current = [];
  };

  const enterInsertMode = (text: string, cursorPosition: number) => {
    insertStartStateRef.current = { text, cursorPosition };
    setVimMode("INSERT");
  };

  return {
    handle(
      input: string,
      key: Key,
      cursorPosition: number,
      valueLength: number,
      currentValue: string,
    ): { consumed: boolean; newCursorPosition?: number; newValue?: string } {
      if (vimMode === "INSERT") {
        if (key.escape || (key.ctrl && input === "c")) {
          let newCursorPosition = cursorPosition;
          if (cursorPosition > 0) {
            newCursorPosition = cursorPosition - 1;
          }
          if (insertStartStateRef.current !== null) {
            saveState(insertStartStateRef.current.text, insertStartStateRef.current.cursorPosition);
            insertStartStateRef.current = null;
          }
          setVimMode("NORMAL");
          return { consumed: true, newCursorPosition };
        }

        if (insertStartStateRef.current === null) {
          insertStartStateRef.current = { text: currentValue, cursorPosition };
        }

        if (key.return) {
          return {
            consumed: true,
            newValue:
              currentValue.slice(0, cursorPosition) + "\n" + currentValue.slice(cursorPosition),
          };
        }

        return { consumed: false };
      }

      if (key.return) return { consumed: false };

      // Check if we have a pending operator waiting for a motion
      if (pendingCommandRef.current) {
        const pending = pendingCommandRef.current;

        // Check if the same operator is pressed again (dd, cc, etc.) - operate on the current line
        if (input === pending.operatorChar) {
          const lineRange = getLineRange(currentValue, cursorPosition);
          const result = pending.operator(currentValue, lineRange, input);

          pendingCommandRef.current = null;

          let finalCursorPosition = result.newCursorPosition;
          if (finalCursorPosition !== undefined) {
            finalCursorPosition = clampToVimBounds(finalCursorPosition, result.newText.length);
          }

          const response: { consumed: boolean; newCursorPosition?: number; newValue?: string } = {
            consumed: true,
            newValue: result.newText,
          };

          if (finalCursorPosition !== undefined) {
            response.newCursorPosition = finalCursorPosition;
          }

          if (result.enterInsertMode) {
            enterInsertMode(currentValue, cursorPosition);
          } else {
            saveState(currentValue, cursorPosition);
          }

          return response;
        }

        // Check if the input is a motion
        if (input in motions) {
          const motion = motions[input];
          const range = motion(currentValue, cursorPosition);
          const result = pending.operator(currentValue, range, input);

          pendingCommandRef.current = null;

          let finalCursorPosition = result.newCursorPosition;
          if (finalCursorPosition !== undefined) {
            finalCursorPosition = clampToVimBounds(finalCursorPosition, result.newText.length);
          }

          const response: { consumed: boolean; newCursorPosition?: number; newValue?: string } = {
            consumed: true,
            newValue: result.newText,
          };

          if (finalCursorPosition !== undefined) {
            response.newCursorPosition = finalCursorPosition;
          }

          if (result.enterInsertMode) {
            enterInsertMode(currentValue, cursorPosition);
          } else {
            saveState(currentValue, cursorPosition);
          }

          return response;
        }

        // Not a motion, cancel the pending operator
        pendingCommandRef.current = null;
        // Continue to process this key as a normal command
      }

      // Handle redo (Ctrl-r)
      if (key.ctrl && input === "r") {
        if (redoStackRef.current.length === 0) return { consumed: true };
        const state = redoStackRef.current.pop()!;
        undoStackRef.current.push({ text: currentValue, cursorPosition });
        return { consumed: true, newValue: state.text, newCursorPosition: state.cursorPosition };
      }

      // Check if input is an operator
      if (input in operators) {
        pendingCommandRef.current = {
          operator: operators[input],
          operatorChar: input,
        };
        return { consumed: true };
      }

      const commands: Record<
        string,
        () => { consumed: boolean; newCursorPosition?: number; newValue?: string }
      > = {
        u: () => {
          if (undoStackRef.current.length === 0) return { consumed: true };
          const state = undoStackRef.current.pop()!;
          redoStackRef.current.push({ text: currentValue, cursorPosition });
          return { consumed: true, newValue: state.text, newCursorPosition: state.cursorPosition };
        },
        i: () => {
          enterInsertMode(currentValue, cursorPosition);
          return { consumed: true };
        },
        a: () => {
          const newCursorPosition = Math.min(valueLength, cursorPosition + 1);
          enterInsertMode(currentValue, cursorPosition);
          return { consumed: true, newCursorPosition };
        },
        h: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
          if (cursorPosition > lineStart) {
            return vimCommandResult(cursorPosition - 1, valueLength);
          }
          return vimCommandResult(cursorPosition, valueLength);
        },
        l: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const lineEnd = getLineEnd(currentValue, currentLineInfo.lineIndex);

          if (cursorPosition < lineEnd) {
            return vimCommandResult(cursorPosition + 1, valueLength);
          }
          return vimCommandResult(cursorPosition, valueLength);
        },
        k: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);

          if (currentLineInfo.lineIndex > 0) {
            const targetLineIndex = currentLineInfo.lineIndex - 1;
            const newCursorPosition = getTargetPosition(
              currentValue,
              targetLineIndex,
              currentLineInfo.columnIndex,
            );
            return vimCommandResult(newCursorPosition, valueLength);
          }

          return vimCommandResult(cursorPosition, valueLength);
        },
        j: () => {
          const lines = currentValue.split("\n");
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);

          if (currentLineInfo.lineIndex < lines.length - 1) {
            const targetLineIndex = currentLineInfo.lineIndex + 1;
            const newCursorPosition = getTargetPosition(
              currentValue,
              targetLineIndex,
              currentLineInfo.columnIndex,
            );
            return vimCommandResult(newCursorPosition, valueLength);
          }

          return vimCommandResult(cursorPosition, valueLength);
        },
        o: () => {
          const lines = currentValue.split("\n");
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const insertPosition = getLineStart(currentValue, currentLineInfo.lineIndex + 1);
          saveState(currentValue, cursorPosition);

          const newValue = [
            currentValue.slice(0, insertPosition),
            currentValue.slice(insertPosition),
          ].join("\n");
          enterInsertMode(currentValue, cursorPosition);

          return {
            consumed: true,
            newCursorPosition: insertPosition,
            newValue,
          };
        },
        O: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const insertPosition = getLineStart(currentValue, currentLineInfo.lineIndex);
          saveState(currentValue, cursorPosition);

          const newValue = [
            currentValue.slice(0, insertPosition),
            currentValue.slice(insertPosition),
          ].join("\n");
          enterInsertMode(currentValue, cursorPosition);

          return {
            consumed: true,
            newCursorPosition: insertPosition,
            newValue,
          };
        },
        x: () => {
          if (valueLength > 0) {
            saveState(currentValue, cursorPosition);
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
        w: () => {
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;

          const currentChar = currentValue[cursorPosition];
          let newCursorPosition: number;

          if (isWhitespace(currentChar)) {
            newCursorPosition = cursorPosition;
            while (
              newCursorPosition < valueLength &&
              isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
          } else {
            let wordEnd = cursorPosition;
            while (wordEnd < valueLength && !isWhitespace(currentValue[wordEnd])) {
              wordEnd++;
            }

            newCursorPosition = wordEnd;
            while (
              newCursorPosition < valueLength &&
              isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
          }

          return vimCommandResult(newCursorPosition, valueLength);
        },
        b: () => {
          const earlyExit = vimEarlyExit(cursorPosition === 0);
          if (earlyExit) return earlyExit;

          let wordStart = cursorPosition;
          while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }
          while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }

          return vimCommandResult(wordStart, valueLength);
        },
        e: () => {
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;

          const currentChar = currentValue[cursorPosition];
          const nextChar = cursorPosition + 1 < valueLength ? currentValue[cursorPosition + 1] : "";
          const atWordEnd =
            !isWhitespace(currentChar) &&
            (cursorPosition === valueLength - 1 || isWhitespace(nextChar));

          let wordEnd: number;

          if (atWordEnd) {
            wordEnd = cursorPosition + 1;
            while (wordEnd < valueLength && isWhitespace(currentValue[wordEnd])) {
              wordEnd++;
            }
            while (wordEnd < valueLength && !isWhitespace(currentValue[wordEnd])) {
              wordEnd++;
            }
          } else {
            wordEnd = cursorPosition;
            while (wordEnd < valueLength && isWhitespace(currentValue[wordEnd])) {
              wordEnd++;
            }
            while (wordEnd < valueLength && !isWhitespace(currentValue[wordEnd])) {
              wordEnd++;
            }
          }

          const vimPos = Math.max(0, wordEnd - 1);
          return vimCommandResult(vimPos, valueLength);
        },
        "0": () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
          return { consumed: true, newCursorPosition: lineStart };
        },
        $: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const lineEnd = getLineEnd(currentValue, currentLineInfo.lineIndex);
          return { consumed: true, newCursorPosition: lineEnd };
        },
        "^": () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const position = getFirstNonWhitespacePosition(currentValue, currentLineInfo.lineIndex);
          return { consumed: true, newCursorPosition: position };
        },
        I: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const position = getFirstNonWhitespacePosition(currentValue, currentLineInfo.lineIndex);
          enterInsertMode(currentValue, cursorPosition);
          return { consumed: true, newCursorPosition: position };
        },
        A: () => {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
            newCursorPosition: getLineInsertEnd(currentValue, currentLineInfo.lineIndex),
          };
        },
      };

      // Ctrl+Arrow keys redirect to vim word navigation (check before regular arrows)
      if (key.ctrl && key.leftArrow) {
        return commands["b"]();
      }

      if (key.ctrl && key.rightArrow) {
        return commands["e"]();
      }

      // Arrow keys and Home/End redirect to vim commands
      if (key.leftArrow) {
        return commands["h"]();
      }

      if (key.rightArrow) {
        return commands["l"]();
      }

      if (key.upArrow) {
        return commands["k"]();
      }

      if (key.downArrow) {
        return commands["j"]();
      }

      if (key.home) {
        return commands["0"]();
      }

      if (key.end) {
        return commands["$"]();
      }

      // Check character commands
      if (input in commands) {
        return commands[input]();
      }

      // NORMAL mode: ignore unhandled keys
      return { consumed: true };
    },
  };
}
