import React, { useState, useEffect } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';

export type Props = {
  readonly placeholder?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
};

function TextInput({ placeholder = '', value, onChange, onSubmit }: Props): React.JSX.Element {
  const [cursorOffset, setCursorOffset] = useState(value.length);

  useEffect(() => {
    setCursorOffset(prevOffset => Math.min(prevOffset, value.length));
  }, [value]);

  const renderWithCursor = () => {
    if (value.length === 0) {
      return placeholder.length > 0
        ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
        : chalk.inverse(' ');
    }

    let result = '';
    for (let i = 0; i < value.length; i++) {
      result += i === cursorOffset ? chalk.inverse(value[i]) : value[i];
    }
    if (cursorOffset === value.length) {
      result += chalk.inverse(' ');
    }
    return result;
  };

  useInput((input, key) => {
    if (key.upArrow || key.downArrow || (key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) {
      return;
    }

    if (key.return) {
      onSubmit?.(value);
      return;
    }

    let nextCursorOffset = cursorOffset;
    let nextValue = value;

    if (key.ctrl && input === 'a') {
      nextCursorOffset = 0;
    } else if (key.ctrl && input === 'e') {
      nextCursorOffset = value.length;
    } else if (key.ctrl && input === 'w') {
      if (cursorOffset > 0) {
        let wordStart = cursorOffset;
        while (wordStart > 0 && /\s/.test(value[wordStart - 1])) {
          wordStart--;
        }
        while (wordStart > 0 && !/\s/.test(value[wordStart - 1])) {
          wordStart--;
        }
        nextValue = value.slice(0, wordStart) + value.slice(cursorOffset);
        nextCursorOffset = wordStart;
      }
    } else if (key.leftArrow) {
      nextCursorOffset--;
    } else if (key.rightArrow) {
      nextCursorOffset++;
    } else if (key.backspace || key.delete) {
      if (cursorOffset > 0) {
        nextValue = value.slice(0, cursorOffset - 1) + value.slice(cursorOffset);
        nextCursorOffset--;
      }
    } else {
      nextValue = value.slice(0, cursorOffset) + input + value.slice(cursorOffset);
      nextCursorOffset += input.length;
    }

    nextCursorOffset = Math.max(0, Math.min(nextCursorOffset, nextValue.length));

    setCursorOffset(nextCursorOffset);

    if (nextValue !== value) {
      onChange(nextValue);
    }
  });

  return <Text>{renderWithCursor()}</Text>;
}

export default TextInput;