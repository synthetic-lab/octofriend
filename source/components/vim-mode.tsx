import React from "react";
import type { CursorVisualPosition, PaintKeyboardEvent, VisualLineRange } from "paintcannon";
import { useColor } from "../theme.ts";
import { Span } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
const isWhitespace = (char: string): boolean => /\s/.test(char);
const isNewline = (char: string): boolean => char === "\n";
const isWordChar = (char: string): boolean => /[a-zA-Z0-9_]/.test(char);
// Note: charwise deletions that cross lines (e.g. dw on "foo\nbar") include
// the trailing newline, joining the lines - matching real vim.
const clampToVimBounds = (pos: number, textLength: number): number => {
  return Math.min(Math.max(0, pos), Math.max(0, textLength - 1));
};
const vimCommandResult = (pos: number, textLength: number) => ({
  consumed: true,
  newCursorPosition: clampToVimBounds(pos, textLength),
});
const vimEarlyExit = (condition: boolean) => {
  if (condition)
    return {
      consumed: true,
    };
  return null;
};
const getLineInfo = (
  text: string,
  position: number,
): {
  lineIndex: number;
  columnIndex: number;
} => {
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
const getLineText = (text: string, lineIndex: number): string => {
  const lines = text.split("\n");
  return lines[lineIndex] || "";
};
const getTargetPosition = (text: string, lineIndex: number, columnIndex: number): number => {
  const line = getLineText(text, lineIndex);
  const targetCol = line.length === 0 ? 0 : Math.min(columnIndex, line.length - 1);
  return getLineStart(text, lineIndex) + targetCol;
};
const getLogicalLineContentRange = (text: string, cursorPosition: number): VisualLineRange => {
  const currentLineInfo = getLineInfo(text, cursorPosition);
  const start = getLineStart(text, currentLineInfo.lineIndex);
  const line = getLineText(text, currentLineInfo.lineIndex);
  return {
    start,
    end: start + line.length,
  };
};
const getCurrentLineRange = (
  text: string,
  cursorPosition: number,
  visualLineRange: VisualLineRange | null,
): VisualLineRange => visualLineRange ?? getLogicalLineContentRange(text, cursorPosition);
const getFirstNonWhitespaceInRange = (text: string, range: VisualLineRange): number => {
  let position = range.start;
  while (position < range.end && isWhitespace(text[position])) position++;
  return position < range.end ? position : range.start;
};
const getNormalLineEnd = (range: VisualLineRange): number =>
  range.end > range.start ? range.end - 1 : range.start;
const includeFollowingNewline = (text: string, range: VisualLineRange): VisualLineRange => {
  let end = range.end;
  if (text[end] === "\r" && text[end + 1] === "\n") end += 2;
  else if (isNewline(text[end])) end += 1;
  return { start: range.start, end };
};
// The rightmost position a NORMAL-mode cursor may occupy: the last character,
// or just past it when the buffer ends with a newline (an empty last line)
const getMaxNormalCursorPosition = (text: string): number =>
  text.length > 0 && isNewline(text[text.length - 1]) ? text.length : Math.max(0, text.length - 1);
// Finds the end of the current or next word, vim-style: a "word" is either a
// run of letters/digits/underscores or a run of other non-blank characters
// (punctuation), and the two classes are distinct - "foo.bar" contains the
// words "foo", ".", and "bar".
const findWordEnd = (text: string, cursorPosition: number): number => {
  const textLength = text.length;
  let position = cursorPosition;
  const currentChar = text[position];
  const nextChar = position + 1 < textLength ? text[position + 1] : "";
  const atWordEnd =
    !isWhitespace(currentChar) &&
    (position === textLength - 1 ||
      isWhitespace(nextChar) ||
      isWordChar(nextChar) !== isWordChar(currentChar));
  // If already at a word end, move forward to find the next one
  if (atWordEnd) position++;
  while (position < textLength && isWhitespace(text[position])) position++;
  if (position < textLength) {
    const isWord = isWordChar(text[position]);
    while (
      position + 1 < textLength &&
      !isWhitespace(text[position + 1]) &&
      isWordChar(text[position + 1]) === isWord
    ) {
      position++;
    }
  }
  return position;
};
type Motion = (
  text: string,
  cursorPosition: number,
  visualLineRange: VisualLineRange | null,
) => {
  start: number;
  end: number;
};
type Operator = (
  text: string,
  range: {
    start: number;
    end: number;
  },
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
  // In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
  // OR (2) a sequence of other non-blank characters (punctuation). These two
  // types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
  w: (text, cursorPosition) => {
    const textLength = text.length;
    if (cursorPosition >= textLength) {
      return {
        start: cursorPosition,
        end: cursorPosition,
      };
    }
    const currentChar = text[cursorPosition];
    let endPosition: number;
    if (isWhitespace(currentChar)) {
      // In whitespace: skip to the next non-whitespace
      endPosition = cursorPosition;
      while (endPosition < textLength && isWhitespace(text[endPosition])) {
        endPosition++;
      }
    } else {
      // On a non-whitespace char: skip chars of the same class, then skip whitespace
      const currentCharIsWord = isWordChar(currentChar);
      endPosition = cursorPosition;

      // Skip characters of the same class
      while (endPosition < textLength && !isWhitespace(text[endPosition])) {
        const charIsWord = isWordChar(text[endPosition]);
        if (charIsWord !== currentCharIsWord) {
          break;
        }
        endPosition++;
      }

      // Skip trailing whitespace to reach start of next word/WORD
      while (endPosition < textLength && isWhitespace(text[endPosition])) {
        endPosition++;
      }
    }
    return {
      start: cursorPosition,
      end: endPosition,
    };
  },
  // A "WORD" is a sequence of non-blank characters, separated by whitespace.
  // "foo-bar" is a single WORD, but "foo bar" is two WORDs.
  W: (text, cursorPosition) => {
    const textLength = text.length;
    if (cursorPosition >= textLength) {
      return {
        start: cursorPosition,
        end: cursorPosition,
      };
    }
    const currentChar = text[cursorPosition];
    let endPosition: number;
    if (isWhitespace(currentChar)) {
      // In whitespace: skip to the next non-whitespace
      endPosition = cursorPosition;
      while (endPosition < textLength && isWhitespace(text[endPosition])) {
        endPosition++;
      }
    } else {
      // On a non-whitespace char: skip the entire WORD, then skip whitespace
      endPosition = cursorPosition;
      while (endPosition < textLength && !isWhitespace(text[endPosition])) {
        endPosition++;
      }
      while (endPosition < textLength && isWhitespace(text[endPosition])) {
        endPosition++;
      }
    }
    return {
      start: cursorPosition,
      end: endPosition,
    };
  },
  // In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
  // OR (2) a sequence of other non-blank characters (punctuation). These two
  // types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
  b: (text, cursorPosition) => {
    if (cursorPosition === 0) {
      return {
        start: 0,
        end: 0,
      };
    }
    let start = cursorPosition;

    // Skip whitespace
    while (start > 0 && isWhitespace(text[start - 1])) {
      start--;
    }

    // If we're at the start of the text after skipping whitespace, we're done
    if (start === 0) {
      return {
        start: 0,
        end: cursorPosition,
      };
    }

    // Determine the character class of the first non-whitespace char we're on
    const firstNonWsChar = text[start - 1];
    const firstCharIsWord = isWordChar(firstNonWsChar);

    // Continue skipping characters of the same class
    while (start > 0 && !isWhitespace(text[start - 1])) {
      const currentChar = text[start - 1];
      const currentCharIsWord = isWordChar(currentChar);
      // Stop when we hit a different character class
      if (currentCharIsWord !== firstCharIsWord) {
        break;
      }
      start--;
    }
    return {
      start: start,
      end: cursorPosition,
    };
  },
  // A "WORD" is a sequence of non-blank characters, separated by whitespace.
  // "foo-bar" is a single WORD, but "foo bar" is two WORDs.
  B: (text, cursorPosition) => {
    if (cursorPosition === 0) {
      return {
        start: 0,
        end: 0,
      };
    }
    let start = cursorPosition;

    // Skip whitespace
    while (start > 0 && isWhitespace(text[start - 1])) {
      start--;
    }

    // Skip all non-whitespace characters (the entire WORD)
    while (start > 0 && !isWhitespace(text[start - 1])) {
      start--;
    }
    return {
      start: start,
      end: cursorPosition,
    };
  },
  e: (text, cursorPosition) => {
    return {
      start: cursorPosition,
      end: findWordEnd(text, cursorPosition) + 1,
    };
  },
  "0": (text, cursorPosition, visualLineRange) => {
    const lineRange = getCurrentLineRange(text, cursorPosition, visualLineRange);
    return {
      start: lineRange.start,
      end: cursorPosition,
    };
  },
  $: (text, cursorPosition, visualLineRange) => {
    const lineRange = getCurrentLineRange(text, cursorPosition, visualLineRange);
    return {
      start: cursorPosition,
      end: lineRange.end,
    };
  },
  "^": (text, cursorPosition, visualLineRange) => {
    const lineRange = getCurrentLineRange(text, cursorPosition, visualLineRange);
    const position = getFirstNonWhitespaceInRange(text, lineRange);
    return {
      start: Math.min(position, cursorPosition),
      end: Math.max(position, cursorPosition),
    };
  },
  // G is a linewise motion: it covers from the start of the current logical
  // line through the end of the buffer.
  G: (text, cursorPosition) => {
    const currentLineInfo = getLineInfo(text, cursorPosition);
    return {
      start: getLineStart(text, currentLineInfo.lineIndex),
      end: text.length,
    };
  },
};
// Motions that delete whole logical lines: dj, dk, dgg, dG, and dd when the
// visual line spans the entire logical line. (A dd that deletes only a
// soft-wrapped portion of a logical line is charwise instead.)
const logicalLinewiseMotions = new Set(["j", "k", "gg", "G", "dd"]);
const operators: Record<string, Operator> = {
  d: (text, { start, end }, motionChar) => {
    const actualEnd = Math.min(end, text.length);
    let actualStart = Math.min(start, actualEnd);

    if (motionChar !== undefined && logicalLinewiseMotions.has(motionChar)) {
      // Linewise deletions remove whole lines. When the range runs to the end
      // of the buffer there is no following newline to consume, so consume
      // the preceding newline instead - otherwise an empty line would be left
      // behind, which never happens in vim.
      if (actualEnd >= text.length && actualStart > 0 && isNewline(text[actualStart - 1])) {
        actualStart--;
      }
      const newText = text.slice(0, actualStart) + text.slice(actualEnd);
      if (newText.length === 0) {
        return {
          newText,
          newCursorPosition: 0,
        };
      }
      // Vim leaves the cursor on the first non-blank of the surviving line
      const clamped = Math.min(actualStart, newText.length - 1);
      const lineInfo = getLineInfo(newText, clamped);
      const lineStart = getLineStart(newText, lineInfo.lineIndex);
      const newCursorPosition = getFirstNonWhitespaceInRange(newText, {
        start: lineStart,
        end: lineStart + getLineText(newText, lineInfo.lineIndex).length,
      });
      return {
        newText,
        newCursorPosition,
      };
    }

    const newText = text.slice(0, actualStart) + text.slice(actualEnd);
    if (newText.length === 0) {
      return {
        newText,
        newCursorPosition: 0,
      };
    }
    // If the deletion emptied the end of the buffer (e.g. D on the last
    // line), the cursor rests on that empty final line, just past the last
    // newline character
    if (actualStart >= newText.length && isNewline(newText[newText.length - 1])) {
      return {
        newText,
        newCursorPosition: newText.length,
      };
    }
    let newCursorPosition = Math.min(actualStart, newText.length - 1);
    // Don't leave the cursor on a newline character (unless it's an empty
    // line, where the newline is the only valid position)
    const cursorLineInfo = getLineInfo(newText, newCursorPosition);
    const cursorLine = getLineText(newText, cursorLineInfo.lineIndex);
    while (
      newCursorPosition > 0 &&
      isNewline(newText[newCursorPosition]) &&
      cursorLine.length > 0
    ) {
      newCursorPosition--;
    }
    return {
      newText,
      newCursorPosition,
    };
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
    return {
      newText,
      newCursorPosition,
      enterInsertMode: true,
    };
  },
};
export function VimModeIndicator({
  vimEnabled,
  vimMode,
}: {
  vimEnabled: boolean;
  vimMode: "NORMAL" | "INSERT";
}) {
  const themeColor = useColor();
  if (!vimEnabled) return null;
  return (
    <TerminalFlex
      style={{
        visibility: vimMode === "INSERT" ? "visible" : "hidden",
        height: 1,
        flexShrink: 0,
      }}
    >
      <Span
        style={{
          color: themeColor,
          fontWeight: "bold",
        }}
      >
        -- INSERT --
      </Span>
    </TerminalFlex>
  );
}
export function useVimKeyHandler(
  vimMode: "NORMAL" | "INSERT",
  setVimMode: (mode: "NORMAL" | "INSERT") => void,
) {
  const pendingCommandRef = React.useRef<PendingCommand | null>(null);
  // Set after pressing "g" (with or without a pending operator), waiting for the
  // second key of a g-prefixed command like gg.
  const pendingGRef = React.useRef<{
    pending: PendingCommand | null;
  } | null>(null);
  const undoStackRef = React.useRef<TextState[]>([]);
  const redoStackRef = React.useRef<TextState[]>([]);
  const insertStartStateRef = React.useRef<TextState | null>(null);
  const saveState = (text: string, cursorPosition: number) => {
    undoStackRef.current.push({
      text,
      cursorPosition,
    });
    redoStackRef.current = [];
  };
  const enterInsertMode = (text: string, cursorPosition: number) => {
    insertStartStateRef.current = {
      text,
      cursorPosition,
    };
    setVimMode("INSERT");
  };
  return {
    handle(
      input: string,
      key: PaintKeyboardEvent,
      cursorPosition: number,
      valueLength: number,
      currentValue: string,
      cursorVisualPosition: CursorVisualPosition | null,
      visualLineRange: VisualLineRange | null,
    ): {
      consumed: boolean;
      newCursorPosition?: number;
      newValue?: string;
    } {
      if (vimMode === "INSERT") {
        if (key.key === "Escape" || (key.ctrlKey && input === "c")) {
          let newCursorPosition = cursorPosition;
          if (cursorPosition > 0) {
            const isAtVisualLineStart = cursorVisualPosition?.column === 0;
            // Special case: if we're at the start of an empty line, stay there
            // (empty line = only valid position is column 0)
            const currentLineInfo = getLineInfo(currentValue, cursorPosition);
            const lineStart = getLineStart(currentValue, currentLineInfo.lineIndex);
            const currentLine = getLineText(currentValue, currentLineInfo.lineIndex);
            if (
              !isAtVisualLineStart &&
              !(cursorPosition === lineStart && currentLine.length === 0)
            ) {
              newCursorPosition = cursorPosition - 1;
            }
          }
          if (insertStartStateRef.current !== null) {
            saveState(insertStartStateRef.current.text, insertStartStateRef.current.cursorPosition);
            insertStartStateRef.current = null;
          }
          setVimMode("NORMAL");
          return {
            consumed: true,
            newCursorPosition,
          };
        }
        if (insertStartStateRef.current === null) {
          insertStartStateRef.current = {
            text: currentValue,
            cursorPosition,
          };
        }
        return {
          consumed: false,
        };
      }
      if (key.key === "Enter")
        return {
          consumed: false,
        };
      if (key.ctrlKey && input === "c") {
        return {
          consumed: false,
        };
      }

      const runPendingOperator = (
        pending: PendingCommand,
        range: {
          start: number;
          end: number;
        },
        motionChar: string,
      ) => {
        const result = pending.operator(currentValue, range, motionChar);
        let finalCursorPosition = result.newCursorPosition;
        if (finalCursorPosition !== undefined) {
          finalCursorPosition = Math.min(
            Math.max(0, finalCursorPosition),
            getMaxNormalCursorPosition(result.newText),
          );
        }
        const response: {
          consumed: boolean;
          newCursorPosition?: number;
          newValue?: string;
        } = {
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
      };

      // Check if we're waiting for the second key of a g-prefixed command (gg)
      if (pendingGRef.current) {
        const { pending } = pendingGRef.current;
        pendingGRef.current = null;
        if (input !== "g") {
          // Unknown g-prefixed command: swallow it and move on
          return {
            consumed: true,
          };
        }
        if (pending) {
          // Operator + gg (e.g. dgg): operate linewise from the first line
          // through the current logical line
          const contentRange = getLogicalLineContentRange(currentValue, cursorPosition);
          const lineRange = {
            start: 0,
            end:
              pending.operatorChar === "d"
                ? includeFollowingNewline(currentValue, contentRange).end
                : contentRange.end,
          };
          return runPendingOperator(pending, lineRange, "gg");
        }
        // gg: jump to the first non-whitespace character of the first line
        const firstLineRange = {
          start: 0,
          end: getLineText(currentValue, 0).length,
        };
        const position = getFirstNonWhitespaceInRange(currentValue, firstLineRange);
        return vimCommandResult(position, valueLength);
      }

      // Check if we have a pending operator waiting for a motion
      if (pendingCommandRef.current) {
        const pending = pendingCommandRef.current;

        // Check if the same operator is pressed again (dd, cc, etc.) - operate on the current line
        if (input === pending.operatorChar) {
          const contentRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          // A dd that covers the entire logical line (i.e. not just a
          // soft-wrapped portion of it) is linewise, like dj/dgg
          const logicalRange = getLogicalLineContentRange(currentValue, cursorPosition);
          const spansLogicalLine =
            contentRange.start === logicalRange.start && contentRange.end === logicalRange.end;
          const lineRange =
            input === "d" ? includeFollowingNewline(currentValue, contentRange) : contentRange;
          pendingCommandRef.current = null;
          return runPendingOperator(
            pending,
            lineRange,
            input === "d" && spansLogicalLine ? "dd" : input,
          );
        }

        // g after an operator (e.g. dg): wait for the second key of the g-command
        if (input === "g") {
          pendingGRef.current = {
            pending,
          };
          pendingCommandRef.current = null;
          return {
            consumed: true,
          };
        }

        // j/k after an operator (dj, dk, cj, ck) are linewise: they operate on
        // the current logical line plus the line below (j) or above (k)
        const verticalDirection =
          input === "j" || input === "ArrowDown"
            ? "j"
            : input === "k" || input === "ArrowUp"
              ? "k"
              : null;
        if (verticalDirection) {
          const currentLineInfo = getLineInfo(currentValue, cursorPosition);
          const lineCount = currentValue.split("\n").length;
          const otherLineIndex =
            verticalDirection === "j"
              ? Math.min(currentLineInfo.lineIndex + 1, lineCount - 1)
              : Math.max(0, currentLineInfo.lineIndex - 1);
          const startLineIndex = Math.min(currentLineInfo.lineIndex, otherLineIndex);
          const endLineIndex = Math.max(currentLineInfo.lineIndex, otherLineIndex);
          const contentRange = {
            start: getLineStart(currentValue, startLineIndex),
            end:
              getLineStart(currentValue, endLineIndex) +
              getLineText(currentValue, endLineIndex).length,
          };
          const lineRange =
            pending.operatorChar === "d"
              ? includeFollowingNewline(currentValue, contentRange)
              : contentRange;
          pendingCommandRef.current = null;
          return runPendingOperator(pending, lineRange, verticalDirection);
        }

        // Check if the input is a motion
        if (input in motions) {
          const motion = motions[input];
          const range = motion(currentValue, cursorPosition, visualLineRange);
          pendingCommandRef.current = null;
          return runPendingOperator(pending, range, input);
        }

        // Not a motion, cancel the pending operator
        pendingCommandRef.current = null;
        // Continue to process this key as a normal command
      }

      // Handle redo (Ctrl-r)
      if (key.ctrlKey && input === "r") {
        if (redoStackRef.current.length === 0)
          return {
            consumed: true,
          };
        const state = redoStackRef.current.pop()!;
        undoStackRef.current.push({
          text: currentValue,
          cursorPosition,
        });
        return {
          consumed: true,
          newValue: state.text,
          newCursorPosition: state.cursorPosition,
        };
      }

      // Start a g-prefixed command (e.g. gg): wait for the second key
      if (input === "g") {
        pendingGRef.current = {
          pending: null,
        };
        return {
          consumed: true,
        };
      }

      // Check if input is an operator
      if (input in operators) {
        pendingCommandRef.current = {
          operator: operators[input],
          operatorChar: input,
        };
        return {
          consumed: true,
        };
      }
      const commands: Record<
        string,
        () => {
          consumed: boolean;
          newCursorPosition?: number;
          newValue?: string;
        }
      > = {
        u: () => {
          if (undoStackRef.current.length === 0)
            return {
              consumed: true,
            };
          const state = undoStackRef.current.pop()!;
          redoStackRef.current.push({
            text: currentValue,
            cursorPosition,
          });
          return {
            consumed: true,
            newValue: state.text,
            newCursorPosition: state.cursorPosition,
          };
        },
        i: () => {
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
          };
        },
        a: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);

          // If the line is empty (just a newline), "a" should behave like "i"
          if (lineRange.start === lineRange.end) {
            enterInsertMode(currentValue, cursorPosition);
            return {
              consumed: true,
            };
          }
          const newCursorPosition = Math.min(valueLength, cursorPosition + 1);
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
            newCursorPosition,
          };
        },
        h: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          if (cursorPosition > lineRange.start) {
            return vimCommandResult(cursorPosition - 1, valueLength);
          }
          return vimCommandResult(cursorPosition, valueLength);
        },
        l: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          const lineEnd = getNormalLineEnd(lineRange);
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
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          const hasExplicitNewline = isNewline(currentValue[lineRange.end]);
          const atEndOfInput = lineRange.end >= currentValue.length;
          const insertPosition = hasExplicitNewline ? lineRange.end + 1 : lineRange.end;
          const insertedText = hasExplicitNewline || atEndOfInput ? "\n" : "\n\n";
          saveState(currentValue, cursorPosition);
          const newValue =
            currentValue.slice(0, insertPosition) +
            insertedText +
            currentValue.slice(insertPosition);
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
            newCursorPosition: hasExplicitNewline
              ? insertPosition
              : Math.min(newValue.length, lineRange.end + 1),
            newValue,
          };
        },
        O: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          const insertPosition = lineRange.start;
          const hasExplicitNewlineBefore =
            insertPosition === 0 || isNewline(currentValue[insertPosition - 1]);
          const insertedText = hasExplicitNewlineBefore ? "\n" : "\n\n";
          saveState(currentValue, cursorPosition);
          const newValue =
            currentValue.slice(0, insertPosition) +
            insertedText +
            currentValue.slice(insertPosition);
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
            newCursorPosition: hasExplicitNewlineBefore ? insertPosition : insertPosition + 1,
            newValue,
          };
        },
        x: () => {
          const char = currentValue[cursorPosition];
          // x can't delete a newline (on an empty line it's a no-op), and does
          // nothing at the end of the buffer
          if (cursorPosition < valueLength && char !== undefined && !isNewline(char)) {
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
            return {
              consumed: true,
              newValue,
              newCursorPosition,
            };
          }
          return {
            consumed: true,
          };
        },
        // In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
        // OR (2) a sequence of other non-blank characters (punctuation). These two
        // types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
        w: () => {
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;
          const currentChar = currentValue[cursorPosition];
          let newCursorPosition: number;
          if (isWhitespace(currentChar)) {
            // In whitespace: skip to the next non-whitespace
            newCursorPosition = cursorPosition;
            while (
              newCursorPosition < valueLength &&
              isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
          } else {
            // On a non-whitespace char: skip chars of the same class, then skip whitespace
            const currentCharIsWord = isWordChar(currentChar);
            newCursorPosition = cursorPosition;

            // Skip characters of the same class
            while (
              newCursorPosition < valueLength &&
              !isWhitespace(currentValue[newCursorPosition])
            ) {
              const charIsWord = isWordChar(currentValue[newCursorPosition]);
              if (charIsWord !== currentCharIsWord) {
                break;
              }
              newCursorPosition++;
            }

            // Skip trailing whitespace to reach start of next word
            while (
              newCursorPosition < valueLength &&
              isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
          }
          return vimCommandResult(newCursorPosition, valueLength);
        },
        // A "WORD" is a sequence of non-blank characters, separated by whitespace.
        // "foo-bar" is a single WORD, but "foo bar" is two WORDs.
        W: () => {
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;
          const currentChar = currentValue[cursorPosition];
          let newCursorPosition: number;
          if (isWhitespace(currentChar)) {
            // In whitespace: skip to the next non-whitespace
            newCursorPosition = cursorPosition;
            while (
              newCursorPosition < valueLength &&
              isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
          } else {
            // On a non-whitespace char: skip the entire WORD, then skip whitespace
            newCursorPosition = cursorPosition;
            while (
              newCursorPosition < valueLength &&
              !isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
            while (
              newCursorPosition < valueLength &&
              isWhitespace(currentValue[newCursorPosition])
            ) {
              newCursorPosition++;
            }
          }
          return vimCommandResult(newCursorPosition, valueLength);
        },
        // In vim, a "word" is either: (1) a sequence of letters/digits/underscores,
        // OR (2) a sequence of other non-blank characters (punctuation). These two
        // types of words are distinct - "foo-bar" contains 3 words: "foo", "-", "bar".
        b: () => {
          const earlyExit = vimEarlyExit(cursorPosition === 0);
          if (earlyExit) return earlyExit;
          let wordStart = cursorPosition;

          // Skip whitespace
          while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }

          // If we're at the start of the text after skipping whitespace, we're done
          if (wordStart === 0) {
            return vimCommandResult(0, valueLength);
          }

          // Determine the character class of the first non-whitespace char we're on
          const firstNonWsChar = currentValue[wordStart - 1];
          const firstCharIsWord = isWordChar(firstNonWsChar);

          // Continue skipping characters of the same class
          while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
            const currentChar = currentValue[wordStart - 1];
            const currentCharIsWord = isWordChar(currentChar);
            // Stop when we hit a different character class
            if (currentCharIsWord !== firstCharIsWord) {
              break;
            }
            wordStart--;
          }
          return vimCommandResult(wordStart, valueLength);
        },
        // A "WORD" is a sequence of non-blank characters, separated by whitespace.
        // "foo-bar" is a single WORD, but "foo bar" is two WORDs.
        B: () => {
          const earlyExit = vimEarlyExit(cursorPosition === 0);
          if (earlyExit) return earlyExit;
          let wordStart = cursorPosition;

          // Skip whitespace
          while (wordStart > 0 && isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }

          // Skip all non-whitespace characters (the entire WORD)
          while (wordStart > 0 && !isWhitespace(currentValue[wordStart - 1])) {
            wordStart--;
          }
          return vimCommandResult(wordStart, valueLength);
        },
        e: () => {
          const earlyExit = vimEarlyExit(cursorPosition >= valueLength - 1);
          if (earlyExit) return earlyExit;
          return vimCommandResult(findWordEnd(currentValue, cursorPosition), valueLength);
        },
        "0": () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          return {
            consumed: true,
            newCursorPosition: lineRange.start,
          };
        },
        $: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          return {
            consumed: true,
            newCursorPosition: getNormalLineEnd(lineRange),
          };
        },
        "^": () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          const position = getFirstNonWhitespaceInRange(currentValue, lineRange);
          return {
            consumed: true,
            newCursorPosition: position,
          };
        },
        G: () => {
          const lines = currentValue.split("\n");
          const lastLineIndex = lines.length - 1;
          const lastLineStart = getLineStart(currentValue, lastLineIndex);
          const lastLine = lines[lastLineIndex];
          if (lastLine.length === 0) {
            // An empty last line's only valid cursor position is its start,
            // which is just past the final newline character
            return {
              consumed: true,
              newCursorPosition: Math.min(lastLineStart, valueLength),
            };
          }
          const lastLineRange = {
            start: lastLineStart,
            end: lastLineStart + lastLine.length,
          };
          const position = getFirstNonWhitespaceInRange(currentValue, lastLineRange);
          return vimCommandResult(position, valueLength);
        },
        I: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          const position = getFirstNonWhitespaceInRange(currentValue, lineRange);
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
            newCursorPosition: position,
          };
        },
        A: () => {
          const lineRange = getCurrentLineRange(currentValue, cursorPosition, visualLineRange);
          enterInsertMode(currentValue, cursorPosition);
          return {
            consumed: true,
            newCursorPosition: lineRange.end,
          };
        },
        D: () => {
          saveState(currentValue, cursorPosition);
          const range = motions["$"](currentValue, cursorPosition, visualLineRange);
          const result = operators["d"](currentValue, range, "$");
          return {
            consumed: true,
            newValue: result.newText,
            newCursorPosition: Math.min(
              Math.max(0, result.newCursorPosition ?? cursorPosition),
              getMaxNormalCursorPosition(result.newText),
            ),
          };
        },
      };

      // Ctrl+Arrow keys redirect to vim word navigation (check before regular arrows)
      if (key.ctrlKey && key.key === "ArrowLeft") {
        return commands["b"]();
      }
      if (key.ctrlKey && key.key === "ArrowRight") {
        return commands["e"]();
      }

      // Arrow keys and Home/End redirect to vim commands
      if (key.key === "ArrowLeft") {
        return commands["h"]();
      }
      if (key.key === "ArrowRight") {
        return commands["l"]();
      }
      if (key.key === "ArrowUp") {
        return commands["k"]();
      }
      if (key.key === "ArrowDown") {
        return commands["j"]();
      }
      if (key.key === "Home") {
        return commands["0"]();
      }
      if (key.key === "End") {
        return commands["$"]();
      }

      // Check character commands
      if (input in commands) {
        return commands[input]();
      }

      // NORMAL mode: ignore unhandled keys
      return {
        consumed: true,
      };
    },
    // True while the handler is waiting for the rest of a multi-key command
    // (e.g. an operator's motion, or the second key of a g-prefixed command).
    // Callers should route keys to `handle` instead of intercepting them while
    // this is true.
    hasPendingCommand() {
      return pendingCommandRef.current !== null || pendingGRef.current !== null;
    },
  };
}
