import React, { useState, useEffect } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';

type Props = {
	readonly placeholder?: string;
	readonly focus?: boolean;
	readonly mask?: string;
	readonly showCursor?: boolean;
	readonly highlightPastedText?: boolean;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit?: (value: string) => void;
};

export default function TextInput({
	value: originalValue,
	placeholder = '',
	focus = true,
	mask,
	highlightPastedText = false,
	showCursor = true,
	onChange,
	onSubmit,
}: Props) {
	const [state, setState] = useState({
		cursorOffset: 0,
		cursorWidth: 0,
	});

	const {cursorOffset, cursorWidth} = state;
  const cursorPosition = originalValue.length + cursorOffset;

  // Correct cursor position if dependencies change or text is shortened.
	useEffect(() => {
		setState(previousState => {
			if (!focus || !showCursor) {
				return previousState;
			}

			if (previousState.cursorOffset === 0) {
				return {
					cursorOffset: 0,
					cursorWidth: 0,
				};
			}

			return previousState;
		});
	}, [originalValue, focus, showCursor]);

	const cursorActualWidth = highlightPastedText ? cursorWidth : 0;

	const value = mask ? mask.repeat(originalValue.length) : originalValue;
	let renderedValue = value;
	let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

	// Fake mouse cursor, because it's too inconvenient to deal with actual cursor and ansi escapes
	if (showCursor && focus) {
		renderedPlaceholder =
			placeholder.length > 0
				? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
				: chalk.inverse(' ');

		renderedValue = value.length > 0 ? '' : chalk.inverse(' ');

		let i = 0;

		for (const char of value) {
			renderedValue +=
				i >= cursorPosition - cursorActualWidth && i <= cursorPosition
					? chalk.inverse(char)
					: char;

			i++;
		}

		if (value.length > 0 && cursorPosition === value.length) {
			renderedValue += chalk.inverse(' ');
		}
	}

	useInput(
		(input, key) => {
			if (
				key.upArrow ||
				key.downArrow ||
				(key.ctrl && input === 'c') ||
				key.tab ||
				(key.shift && key.tab)
			) {
				return;
			}

			if (key.return) {
				if (onSubmit) {
					onSubmit(originalValue);
				}

				return;
			}

			let nextCursorPosition = cursorPosition;
			let nextValue = originalValue;
			let nextCursorWidth = 0;

			if (key.ctrl && input === 'a') {
				nextCursorPosition = 0;
			} else if (key.ctrl && input === 'e') {
				nextCursorPosition = originalValue.length;
			} else if (key.ctrl && input === 'b') {
				if (showCursor && cursorPosition > 0) {
					nextCursorPosition = cursorPosition - 1;
				}
			} else if (key.ctrl && input === 'f') {
				if (showCursor && cursorPosition < originalValue.length) {
					nextCursorPosition = cursorPosition + 1;
				}
			} else if (key.meta && input === 'b') {
				if (showCursor && cursorPosition > 0) {
					let wordStart = cursorPosition;
					while (wordStart > 0 && /\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					while (wordStart > 0 && !/\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					nextCursorPosition = wordStart;
				}
			} else if (key.meta && input === 'f') {
				if (showCursor && cursorPosition < originalValue.length) {
					let wordEnd = cursorPosition;
					while (wordEnd < originalValue.length && /\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					while (wordEnd < originalValue.length && !/\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					nextCursorPosition = wordEnd;
				}
			} else if (key.ctrl && input === 'w') {
				if (cursorPosition > 0) {
					let wordStart = cursorPosition;
					while (wordStart > 0 && /\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					while (wordStart > 0 && !/\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					nextValue = originalValue.slice(0, wordStart) + originalValue.slice(cursorPosition);
					nextCursorPosition = wordStart;
				}
			} else if (key.ctrl && input === 'h') {
				if (cursorPosition > 0) {
					nextValue =
						originalValue.slice(0, cursorPosition - 1) +
						originalValue.slice(cursorPosition, originalValue.length);
					nextCursorPosition = cursorPosition - 1;
				}
			} else if (key.ctrl && input === 'd') {
				if (cursorPosition < originalValue.length) {
					nextValue =
						originalValue.slice(0, cursorPosition) +
						originalValue.slice(cursorPosition + 1, originalValue.length);
				}
			} else if (key.meta && input === 'd') {
				if (cursorPosition < originalValue.length) {
					let wordEnd = cursorPosition;
					while (wordEnd < originalValue.length && /\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					while (wordEnd < originalValue.length && !/\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					nextValue = originalValue.slice(0, cursorPosition) + originalValue.slice(wordEnd);
				}
			} else if (key.ctrl && input === 'k') {
				nextValue = originalValue.slice(0, cursorPosition);
			} else if (key.ctrl && input === 'u') {
				nextValue = originalValue.slice(cursorPosition);
				nextCursorPosition = 0;
			} else if (key.leftArrow) {
				if (showCursor) {
					nextCursorPosition--;
				}
			} else if (key.rightArrow) {
				if (showCursor) {
					nextCursorPosition++;
				}
			} else if (key.backspace || key.delete) {
				if (cursorPosition > 0) {
					nextValue =
						originalValue.slice(0, cursorPosition - 1) +
						originalValue.slice(cursorPosition, originalValue.length);

					nextCursorPosition--;
				}
			} else {
				nextValue =
					originalValue.slice(0, cursorPosition) +
					input +
					originalValue.slice(cursorPosition, originalValue.length);

				nextCursorPosition += input.length;

				if (input.length > 1) {
					nextCursorWidth = input.length;
				}
			}

			if (cursorPosition < 0 || nextCursorPosition < 0) {
				nextCursorPosition = 0;
			}

			if (cursorPosition > originalValue.length) {
				nextCursorPosition = originalValue.length;
			}

      const nextCursorOffset = nextCursorPosition - nextValue.length;
      if(nextCursorOffset !== cursorOffset || nextCursorWidth !== cursorWidth) {
        setState({
          cursorOffset: nextCursorOffset,
          cursorWidth: nextCursorWidth,
        });
      }

			if (nextValue !== originalValue) {
				onChange(nextValue);
			}
		},
		{isActive: focus},
	);

	return (
		<Text>
			{placeholder
				? value.length > 0
					? renderedValue
					: renderedPlaceholder
				: renderedValue}
		</Text>
	);
}
