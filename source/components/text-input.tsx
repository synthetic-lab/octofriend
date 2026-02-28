import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { Text, useInput, Box, DOMElement, measureElement } from "ink";
import chalk from "chalk";
import { useVimKeyHandler } from "./vim-mode.tsx";
import { useEmacsKeyHandler } from "./emacs-mode.tsx";
import { wrapTextWithMapping } from "../text-wrap.ts";
import stringWidth from "string-width";
import { ImageInfo, parseImagePaths } from "../utils/image-utils.ts";
import { MultimodalConfig } from "../providers.ts";

function getImageBadgeText(index: number): string {
  return `⟦ 📎 Image Attachment #${index + 1} ⟧`;
}

function getImageBadgeWidth(index: number): number {
  return stringWidth(getImageBadgeText(index)) + 1; // extra space for marginRight
}

const LOADING_BADGE_TEXT = "⟦ ⏳ Attaching image... ⟧";
const LOADING_BADGE_WIDTH = stringWidth(LOADING_BADGE_TEXT) + 1;

type BadgeItem = { index: number; isLoading: boolean };

function computeImageBadgeLayout(imageCount: number, isLoading: boolean, containerWidth: number) {
  const badgeRows: BadgeItem[][] = [];
  let currentRow: BadgeItem[] = [];
  let currentRowWidth = 0;

  const totalItems = imageCount + (isLoading ? 1 : 0);

  for (let i = 0; i < totalItems; i++) {
    // only 1 loading badge will be shown at a time (sequential image loading)
    // the loading badge will be on the same row as the most recent image badge if it fits
    // otherwise on a new row
    const isCurrentLoading = isLoading && i === totalItems - 1;
    const currentBadgeWidth = isCurrentLoading ? LOADING_BADGE_WIDTH : getImageBadgeWidth(i);

    if (currentRow.length > 0 && currentRowWidth + currentBadgeWidth > containerWidth) {
      badgeRows.push(currentRow);
      currentRow = [{ index: i, isLoading: isCurrentLoading }];
      currentRowWidth = currentBadgeWidth;
    } else {
      currentRow.push({ index: i, isLoading: isCurrentLoading });
      currentRowWidth += currentBadgeWidth;
    }
  }

  let remainingWidthForText = containerWidth;

  if (currentRow.length > 0) {
    badgeRows.push(currentRow);
    remainingWidthForText = containerWidth - currentRowWidth;
  }

  return { badgeRows, remainingWidthForText };
}

export const LINE_SPLIT_REGEX = /\r\n|\r|\n/;

type Props = {
  readonly placeholder?: string;
  readonly focus?: boolean;
  readonly mask?: string;
  readonly showCursor?: boolean;
  readonly highlightPastedText?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onImagePathsAttached?: (imagePaths: string[]) => any;
  readonly onSubmit?: (value: string) => void;
  readonly showLoadingImageBadge?: boolean;
  readonly vimEnabled?: boolean;
  readonly vimMode?: "NORMAL" | "INSERT";
  readonly setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  readonly attachedImages?: ImageInfo[];
  readonly onRemoveLastImage?: () => any;
  readonly modalities?: MultimodalConfig;
};

export default function TextInput({
  attachedImages,
  value: originalValue,
  showLoadingImageBadge = false,
  placeholder = "",
  focus = true,
  mask,
  highlightPastedText = false,
  showCursor = true,
  onChange,
  onImagePathsAttached,
  onRemoveLastImage,
  onSubmit,
  vimEnabled = false,
  vimMode = "NORMAL",
  setVimMode,
  modalities,
}: Props) {
  const [state, setState] = useState({
    cursorOffset: 0,
    cursorWidth: 0,
  });
  const [isInitializing, setIsInitializing] = useState(true);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const containerRef = useRef<DOMElement>(null);

  const { cursorOffset, cursorWidth } = state;
  const valueRef = useRef(originalValue);
  const cursorOffsetRef = useRef(cursorOffset);
  const cursorWidthRef = useRef(cursorWidth);
  const renderCursorPosition = originalValue.length + cursorOffset;

  useEffect(() => {
    // useInput sets rawMode to true and then false on mount;
    const timer = setTimeout(() => setIsInitializing(false), 0);
    return () => clearTimeout(timer);
  }, []);

  function handleElementSize() {
    if (containerRef.current) {
      const dimensions = measureElement(containerRef.current);
      setMeasuredWidth(dimensions.width);
    }
  }

  // Measure container width on layout
  useLayoutEffect(() => {
    handleElementSize();
  });

  useEffect(() => {
    const handleResize = () => {
      setTimeout(handleElementSize, 0);
    };
    process.stdout.on("resize", handleResize);

    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    valueRef.current = originalValue;
  }, [originalValue]);

  useEffect(() => {
    cursorOffsetRef.current = cursorOffset;
    cursorWidthRef.current = cursorWidth;
  }, [cursorOffset, cursorWidth]);

  // Create Vim handler
  const vimHandler = useVimKeyHandler(vimMode, setVimMode || (() => {}));

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

  const { badgeRows: imageBadgeRows, remainingWidthForText } = useMemo(
    () =>
      computeImageBadgeLayout(attachedImages?.length ?? 0, showLoadingImageBadge, measuredWidth),
    [attachedImages?.length, showLoadingImageBadge, measuredWidth],
  );

  const hasImageBadges = imageBadgeRows.length > 0;
  const MIN_USABLE_TEXT_WIDTH = 5;
  const textStartsOnBadgeRow = hasImageBadges && remainingWidthForText >= MIN_USABLE_TEXT_WIDTH;
  const remainingWidthForFirstTextLine = textStartsOnBadgeRow ? remainingWidthForText : undefined;

  const { wrapped, originalToWrapped } = wrapTextWithMapping(
    value,
    measuredWidth,
    remainingWidthForFirstTextLine,
  );
  const wrappedCursorPosition = originalToWrapped[renderCursorPosition] ?? renderCursorPosition;

  let renderedValue = wrapped;
  let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

  // Fake mouse cursor, because it's too inconvenient to deal with actual cursor and ansi escapes
  if (showCursor && focus) {
    renderedPlaceholder =
      placeholder.length > 0
        ? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
        : chalk.inverse(" ");

    renderedValue = wrapped.length > 0 ? "" : chalk.inverse(" ");

    const lines = wrapped.split(LINE_SPLIT_REGEX);
    let i = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];

      for (const char of line) {
        renderedValue += i === wrappedCursorPosition ? chalk.inverse(char) : char;
        i++;
      }

      if (
        i === wrappedCursorPosition &&
        !(lineIndex === 0 && line.length === 0 && wrappedCursorPosition === 0)
      ) {
        renderedValue += chalk.inverse(" ");
      }

      if (lineIndex < lines.length - 1) {
        renderedValue += "\n";
        i++;
      }
    }
  }

  useInput(
    (input, key) => {
      if (isInitializing) return;

      // Prevent Ctrl+p from being typed into input (it opens the menu)
      if (key.ctrl && input === "p") {
        return;
      }

      const currentValue = valueRef.current;
      const previousCursorOffset = cursorOffsetRef.current;
      const previousCursorWidth = cursorWidthRef.current;
      let cursorPosition = currentValue.length + previousCursorOffset;

      if (input.length > 1) {
        const imagePaths = parseImagePaths(input);

        if (imagePaths && onImagePathsAttached) {
          onImagePathsAttached(imagePaths);
          if (modalities?.image?.enabled) {
            // automatic behavior when pasting an image is pasting its filePath as text
            // on models that support image inputs, attach an image rather than input the filePath in TextInput
            return;
          }
        }
      }

      // Try Vim handler first if Vim mode is enabled
      if (vimEnabled) {
        const vimResult = vimHandler.handle(
          input,
          key,
          cursorPosition,
          currentValue.length,
          currentValue,
        );
        if (vimResult.consumed) {
          // Vim consumed the key - check if we need to update value or cursor position
          if (vimResult.newValue !== undefined) {
            // Vim modified the text value (e.g., 'x' deleted a character)
            onChange(vimResult.newValue);
          }
          if (vimResult.newCursorPosition !== undefined) {
            const valueLength =
              vimResult.newValue !== undefined ? vimResult.newValue.length : currentValue.length;

            const newCursorOffset = vimResult.newCursorPosition - valueLength;
            cursorOffsetRef.current = newCursorOffset;
            cursorWidthRef.current = 0;
            setState({
              cursorOffset: newCursorOffset,
              cursorWidth: 0,
            });
          }
          return; // Vim consumed the key
        }
        // Vim didn't consume it, continue with normal processing
      }

      if (
        key.upArrow ||
        key.downArrow ||
        (key.ctrl && input === "c") ||
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
      const emacsResult = emacsHandler.handle(
        input,
        key,
        cursorPosition,
        currentValue.length,
        currentValue,
        showCursor,
      );
      if (emacsResult.consumed) {
        if (emacsResult.newValue !== undefined) {
          onChange(emacsResult.newValue);
        }
        if (emacsResult.newCursorPosition !== undefined) {
          const valueLength =
            emacsResult.newValue !== undefined ? emacsResult.newValue.length : currentValue.length;
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
        } else if (attachedImages && attachedImages.length > 0) {
          if (onRemoveLastImage) {
            onRemoveLastImage();
          }
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
    { isActive: focus },
  );

  const toRender =
    (placeholder ? (value.length > 0 ? renderedValue : renderedPlaceholder) : renderedValue) || "";

  const lines = toRender.split(LINE_SPLIT_REGEX);

  const hasSharedRow = textStartsOnBadgeRow && imageBadgeRows.length > 0;
  const textLinesToRender = hasSharedRow ? lines.slice(1) : lines;

  return (
    <Box ref={containerRef} flexGrow={1} flexDirection="column">
      {imageBadgeRows.map((imageBadgeItems, rowIndex) => {
        const isSharedRow = hasSharedRow && rowIndex === imageBadgeRows.length - 1;

        return (
          <Box flexDirection="row" height={1} key={`badge-row-${rowIndex}`}>
            {imageBadgeItems.map(item => (
              <Box key={`image-badge-${item.index}`} marginRight={1}>
                <Text inverse>
                  {item.isLoading ? LOADING_BADGE_TEXT : getImageBadgeText(item.index)}
                </Text>
              </Box>
            ))}
            {isSharedRow && <Text>{lines[0]}</Text>}
          </Box>
        );
      })}
      {textLinesToRender.map((line, index) => {
        return (
          <Box height={1} key={`text-line-${index}`}>
            <Text>{line}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
