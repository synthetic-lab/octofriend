import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { Text, useInput, Box, DOMElement, measureElement } from "ink";
import chalk from "chalk";
import { useVimKeyHandler } from "./vim-mode.tsx";
import { useEmacsKeyHandler } from "./emacs-mode.tsx";
import { wrapTextWithMapping } from "../text-wrap.ts";
import stringWidth from "string-width";
import { ImageInfo, parseImagePaths } from "../utils/image-utils.ts";

function getBadgeText(index: number): string {
  return `⟦ 📎 Image Attachment #${index + 1} ⟧`;
}

function getBadgeWidth(index: number): number {
  return stringWidth(getBadgeText(index)) + 1; // +1 for marginRight
}

const LOADING_BADGE_TEXT = "⟦ ⏳ Attaching image... ⟧";
const LOADING_BADGE_WIDTH = stringWidth(LOADING_BADGE_TEXT) + 1;

function computeBadgeLayout(imageCount: number, isLoading: boolean, containerWidth: number) {
  const rows: number[][] = [];
  let currentRow: number[] = [];
  let currentRowWidth = 0;

  for (let i = 0; i < imageCount; i++) {
    const w = getBadgeWidth(i);
    if (currentRow.length > 0 && currentRowWidth + w > containerWidth) {
      rows.push(currentRow);
      currentRow = [i];
      currentRowWidth = w;
    } else {
      currentRow.push(i);
      currentRowWidth += w;
    }
  }

  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  let loadingOnNewRow = false;
  if (isLoading) {
    if (rows.length > 0 && currentRowWidth + LOADING_BADGE_WIDTH > containerWidth) {
      loadingOnNewRow = true;
      currentRowWidth = LOADING_BADGE_WIDTH;
    } else {
      currentRowWidth += LOADING_BADGE_WIDTH;
    }
  }

  const lastRowWidth = rows.length > 0 || isLoading ? currentRowWidth : 0;
  const remainingWidth = Math.max(0, containerWidth - lastRowWidth);

  return { rows, lastRowWidth, remainingWidth, loadingOnNewRow };
}

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
  readonly isLoadingImage?: boolean;
  readonly vimEnabled?: boolean;
  readonly vimMode?: "NORMAL" | "INSERT";
  readonly setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  readonly attachedImages?: ImageInfo[];
  readonly onRemoveLastImage?: () => any;
  readonly multimodal?: boolean;
};

export default function TextInput({
  attachedImages,
  value: originalValue,
  isLoadingImage = false,
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
  multimodal = false,
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

  // Measure container widths on layout
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

  const badgeLayout = computeBadgeLayout(
    attachedImages?.length ?? 0,
    isLoadingImage,
    measuredWidth,
  );

  const badgeAreaRows: { badges: number[]; showLoading: boolean }[] = [];
  for (let r = 0; r < badgeLayout.rows.length; r++) {
    badgeAreaRows.push({ badges: badgeLayout.rows[r]!, showLoading: false });
  }
  if (isLoadingImage) {
    if (badgeLayout.loadingOnNewRow || badgeLayout.rows.length === 0) {
      badgeAreaRows.push({ badges: [], showLoading: true });
    } else {
      badgeAreaRows[badgeAreaRows.length - 1]!.showLoading = true;
    }
  }

  const hasBadgeArea = badgeAreaRows.length > 0;
  const MIN_TEXT_WIDTH = 5;
  const textStartsOnBadgeRow = hasBadgeArea && badgeLayout.remainingWidth >= MIN_TEXT_WIDTH;
  const firstLineWidth = textStartsOnBadgeRow ? badgeLayout.remainingWidth : undefined;

  const { wrapped, originalToWrapped } = wrapTextWithMapping(value, measuredWidth, firstLineWidth);
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

    const lines = wrapped.split("\n");
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

      if (input.length > 1) {
        const imagePaths = parseImagePaths(input);
        if (imagePaths && onImagePathsAttached) {
          onImagePathsAttached(imagePaths);
          if (multimodal) {
            return;
          }
        }
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

  const lines = toRender.split("\n");

  const badgeOnlyRows = textStartsOnBadgeRow ? badgeAreaRows.slice(0, -1) : badgeAreaRows;
  const sharedRow = textStartsOnBadgeRow ? badgeAreaRows[badgeAreaRows.length - 1] : null;
  const textOnlyLines = textStartsOnBadgeRow ? lines.slice(1) : lines;

  return (
    <Box ref={containerRef} flexGrow={1} flexDirection="column">
      {badgeOnlyRows.map((row, rowIndex) => (
        <Box flexDirection="row" height={1} key={`badge-row-${rowIndex}`}>
          {row.badges.map(i => (
            <Box key={`image-${i}`} marginRight={1}>
              <Text inverse>{getBadgeText(i)}</Text>
            </Box>
          ))}
          {row.showLoading && (
            <Box marginRight={1}>
              <Text inverse>{LOADING_BADGE_TEXT}</Text>
            </Box>
          )}
        </Box>
      ))}
      {sharedRow && (
        <Box flexDirection="row" height={1}>
          {sharedRow.badges.map(i => (
            <Box key={`image-${i}`} marginRight={1}>
              <Text inverse>{getBadgeText(i)}</Text>
            </Box>
          ))}
          {sharedRow.showLoading && (
            <Box marginRight={1}>
              <Text inverse>{LOADING_BADGE_TEXT}</Text>
            </Box>
          )}
          <Text>{lines[0]}</Text>
        </Box>
      )}
      {textOnlyLines.map((line, index) => (
        <Box height={1} key={`line-${textStartsOnBadgeRow ? index + 1 : index}`}>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
