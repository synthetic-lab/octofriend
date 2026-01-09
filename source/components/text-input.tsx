import React, { useState, useEffect, useRef } from 'react';
import { Text, useInput } from 'ink';
import chalk from 'chalk';
import { useVimKeyHandler } from './vim-mode.tsx';
import { useEmacsKeyHandler } from './emacs-mode.tsx';

type Props = {
	readonly placeholder?: string;
	readonly focus?: boolean;
	readonly mask?: string;
	readonly showCursor?: boolean;
	readonly highlightPastedText?: boolean;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit?: (value: string) => void;
	readonly vimEnabled?: boolean;
	readonly vimMode?: 'NORMAL' | 'INSERT';
	readonly setVimMode?: (mode: 'NORMAL' | 'INSERT') => void;
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
	vimEnabled = false,
	vimMode = 'NORMAL',
	setVimMode,
}: Props) {
	const [state, setState] = useState({
		cursorOffset: 0,
		cursorWidth: 0,
	});
	const [isInitializing, setIsInitializing] = useState(true);

	const {cursorOffset, cursorWidth} = state;
	const valueRef = useRef(originalValue);
	const cursorOffsetRef = useRef(cursorOffset);
	const cursorWidthRef = useRef(cursorWidth);
	const renderCursorPosition = originalValue.length + cursorOffset;

	useEffect(() => {
		// useInput sets rawMode to true and then false on mount;
		const timer = setTimeout(() => setIsInitializing(false), 0);
		return () => clearTimeout(timer);
	}, []);

	useEffect(() => {
		valueRef.current = originalValue;
	}, [originalValue]);

	useEffect(() => {
		cursorOffsetRef.current = cursorOffset;
		cursorWidthRef.current = cursorWidth;
	}, [cursorOffset, cursorWidth]);

	// Create Vim handler
	const vimHandler = useVimKeyHandler(
		vimMode,
		setVimMode || (() => {})
	);

	// Create Emacs handler
	const emacsHandler = useEmacsKeyHandler();

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

		const lines = value.split('\n');
		let i = 0;

		for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
			const line = lines[lineIndex];

			for (const char of line) {
				renderedValue += i === renderCursorPosition ? chalk.inverse(char) : char;
				i++;
			}

			if (
        i === renderCursorPosition
        && !(lineIndex === 0 && line.length === 0 && renderCursorPosition === 0)
      ) {
				renderedValue += chalk.inverse(' ');
			}

			if (lineIndex < lines.length - 1) {
				renderedValue += '\n';
				i++;
			}
		}
	}

	useInput(
		(input, key) => {
			if (isInitializing) return;

			const currentValue = valueRef.current;
			const previousCursorOffset = cursorOffsetRef.current;
			const previousCursorWidth = cursorWidthRef.current;
			let cursorPosition = currentValue.length + previousCursorOffset;

			// Try Vim handler first if Vim mode is enabled
			if (vimEnabled) {
				const vimResult = vimHandler.handle(input, key, cursorPosition, currentValue.length, currentValue);
				if (vimResult.consumed) {
					// Vim consumed the key - check if we need to update value or cursor position
					if (vimResult.newValue !== undefined) {
						// Vim modified the text value (e.g., 'x' deleted a character)
						onChange(vimResult.newValue);
					}
					if (vimResult.newCursorPosition !== undefined) {
						const valueLength = vimResult.newValue !== undefined ? vimResult.newValue.length : currentValue.length;
						const newCursorOffset = vimResult.newCursorPosition - valueLength;
						cursorOffsetRef.current = newCursorOffset;
						cursorWidthRef.current = 0;
						setState({
							cursorOffset: newCursorOffset,
							cursorWidth: 0,
						});
					}
					return;  // Vim consumed the key
				}
				// Vim didn't consume it, continue with normal processing
			}

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
					onSubmit(valueRef.current);
				}

				return;
			}

			// Try Emacs handler
			const emacsResult = emacsHandler.handle(input, key, cursorPosition, currentValue.length, currentValue, showCursor);
			if (emacsResult.consumed) {
				if (emacsResult.newValue !== undefined) {
					onChange(emacsResult.newValue);
				}
				if (emacsResult.newCursorPosition !== undefined) {
					const valueLength = emacsResult.newValue !== undefined ? emacsResult.newValue.length : currentValue.length;
					const newCursorOffset = emacsResult.newCursorPosition - valueLength;
					cursorOffsetRef.current = newCursorOffset;
					cursorWidthRef.current = 0;
					setState({
						cursorOffset: newCursorOffset,
						cursorWidth: 0,
					});
				}
				return;
			}

			let nextCursorPosition = cursorPosition;
			let nextValue = currentValue;
			let nextCursorWidth = 0;

			if (key.leftArrow) {
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
						currentValue.slice(0, cursorPosition - 1) +
						currentValue.slice(cursorPosition, currentValue.length);

					nextCursorPosition--;
				}
			} else {
				nextValue =
					currentValue.slice(0, cursorPosition) +
					input +
					currentValue.slice(cursorPosition, currentValue.length);

				nextCursorPosition += input.length;

				if (input.length > 1) {
					nextCursorWidth = input.length;
				}
			}

			if (cursorPosition < 0 || nextCursorPosition < 0) {
				nextCursorPosition = 0;
			}

			if (nextCursorPosition > nextValue.length) {
				nextCursorPosition = nextValue.length;
			}

			const nextCursorOffset = nextCursorPosition - nextValue.length;
			if (nextCursorOffset !== previousCursorOffset || nextCursorWidth !== previousCursorWidth) {
				cursorOffsetRef.current = nextCursorOffset;
				cursorWidthRef.current = nextCursorWidth;
				setState({
					cursorOffset: nextCursorOffset,
					cursorWidth: nextCursorWidth,
				});
			}

			if (nextValue !== currentValue) {
				valueRef.current = nextValue;
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
