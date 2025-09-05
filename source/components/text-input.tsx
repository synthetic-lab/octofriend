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
		cursorOffset: (originalValue || '').length,
		cursorWidth: 0,
	});

	const {cursorOffset, cursorWidth} = state;

  // Correct cursor position if dependencies change or text is shortened.
	useEffect(() => {
		setState(previousState => {
			if (!focus || !showCursor) {
				return previousState;
			}

			const newValue = originalValue || '';

			if (previousState.cursorOffset > newValue.length - 1) {
				return {
					cursorOffset: newValue.length,
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
				i >= cursorOffset - cursorActualWidth && i <= cursorOffset
					? chalk.inverse(char)
					: char;

			i++;
		}

		if (value.length > 0 && cursorOffset === value.length) {
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

			let nextCursorOffset = cursorOffset;
			let nextValue = originalValue;
			let nextCursorWidth = 0;

			if (key.ctrl && input === 'a') {
				nextCursorOffset = 0;
			} else if (key.ctrl && input === 'e') {
				nextCursorOffset = originalValue.length;
			} else if (key.ctrl && input === 'b') {
				if (showCursor && cursorOffset > 0) {
					nextCursorOffset = cursorOffset - 1;
				}
			} else if (key.ctrl && input === 'f') {
				if (showCursor && cursorOffset < originalValue.length) {
					nextCursorOffset = cursorOffset + 1;
				}
			} else if (key.meta && input === 'b') {
				if (showCursor && cursorOffset > 0) {
					let wordStart = cursorOffset;
					while (wordStart > 0 && /\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					while (wordStart > 0 && !/\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					nextCursorOffset = wordStart;
				}
			} else if (key.meta && input === 'f') {
				if (showCursor && cursorOffset < originalValue.length) {
					let wordEnd = cursorOffset;
					while (wordEnd < originalValue.length && /\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					while (wordEnd < originalValue.length && !/\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					nextCursorOffset = wordEnd;
				}
			} else if (key.ctrl && input === 'w') {
				if (cursorOffset > 0) {
					let wordStart = cursorOffset;
					while (wordStart > 0 && /\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					while (wordStart > 0 && !/\s/.test(originalValue[wordStart - 1])) {
						wordStart--;
					}
					nextValue = originalValue.slice(0, wordStart) + originalValue.slice(cursorOffset);
					nextCursorOffset = wordStart;
				}
			} else if (key.ctrl && input === 'h') {
				if (cursorOffset > 0) {
					nextValue =
						originalValue.slice(0, cursorOffset - 1) +
						originalValue.slice(cursorOffset, originalValue.length);
					nextCursorOffset = cursorOffset - 1;
				}
			} else if (key.ctrl && input === 'd') {
				if (cursorOffset < originalValue.length) {
					nextValue =
						originalValue.slice(0, cursorOffset) +
						originalValue.slice(cursorOffset + 1, originalValue.length);
				}
			} else if (key.meta && input === 'd') {
				if (cursorOffset < originalValue.length) {
					let wordEnd = cursorOffset;
					while (wordEnd < originalValue.length && /\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					while (wordEnd < originalValue.length && !/\s/.test(originalValue[wordEnd])) {
						wordEnd++;
					}
					nextValue = originalValue.slice(0, cursorOffset) + originalValue.slice(wordEnd);
				}
			} else if (key.ctrl && input === 'k') {
				nextValue = originalValue.slice(0, cursorOffset);
			} else if (key.ctrl && input === 'u') {
				nextValue = originalValue.slice(cursorOffset);
				nextCursorOffset = 0;
			} else if (key.leftArrow) {
				if (showCursor) {
					nextCursorOffset--;
				}
			} else if (key.rightArrow) {
				if (showCursor) {
					nextCursorOffset++;
				}
			} else if (key.backspace || key.delete) {
				if (cursorOffset > 0) {
					nextValue =
						originalValue.slice(0, cursorOffset - 1) +
						originalValue.slice(cursorOffset, originalValue.length);

					nextCursorOffset--;
				}
			} else {
				nextValue =
					originalValue.slice(0, cursorOffset) +
					input +
					originalValue.slice(cursorOffset, originalValue.length);

				nextCursorOffset += input.length;

				if (input.length > 1) {
					nextCursorWidth = input.length;
				}
			}

			if (cursorOffset < 0) {
				nextCursorOffset = 0;
			}

			if (cursorOffset > originalValue.length) {
				nextCursorOffset = originalValue.length;
			}

			setState({
				cursorOffset: nextCursorOffset,
				cursorWidth: nextCursorWidth,
			});

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
