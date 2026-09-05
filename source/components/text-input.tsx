import React, { useCallback, useEffect, useRef } from "react";
import type { PaintFile, PaintKeyboardEvent, TextAreaElement } from "paintcannon";
import { Div, Span, Textarea, useApp } from "paintcannon-react";
import { useVimKeyHandler } from "./vim-mode.tsx";
import { DEFAULT_INPUT_MODE, type InputMode, type VimMode } from "./input-mode.ts";
import { useKeyboardScopeActive } from "../hooks/use-keyboard.ts";
import { FOREGROUND_COLOR } from "../theme.ts";
import { ImageInfo } from "../utils/image-utils.ts";

function getImageBadgeText(index: number): string {
  return `⟦ 📎 Image Attachment #${index + 1} ⟧`;
}

const LOADING_BADGE_TEXT = "⟦ ⏳ Attaching image... ⟧";

type Props = {
  readonly placeholder?: string;
  readonly focus?: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onImageFilesAttached?: (files: PaintFile[]) => unknown;
  readonly onSubmit?: (value: string) => void;
  readonly showLoadingImageBadge?: boolean;
  readonly inputMode?: InputMode;
  readonly setVimMode?: (mode: VimMode) => void;
  readonly attachedImages?: ImageInfo[];
  readonly onRemoveLastImage?: () => unknown;
  readonly onKeyDown?: (event: PaintKeyboardEvent) => void;
};

function characterIndexToStringIndex(value: string, characterIndex: number): number {
  return Array.from(value).slice(0, characterIndex).join("").length;
}

function stringIndexToCharacterIndex(value: string, stringIndex: number): number {
  return Array.from(value.slice(0, stringIndex)).length;
}

export default function TextInput({
  attachedImages = [],
  value,
  showLoadingImageBadge = false,
  placeholder = "",
  focus = true,
  onChange,
  onImageFilesAttached,
  onRemoveLastImage,
  onSubmit,
  inputMode = DEFAULT_INPUT_MODE,
  setVimMode,
  onKeyDown,
}: Props) {
  const { paintCannon } = useApp();
  const textareaRef = useRef<TextAreaElement>(null);
  const vimHandler = useVimKeyHandler(inputMode, setVimMode ?? (() => {}));

  const scopeActive = useKeyboardScopeActive();
  const focused = focus && scopeActive;

  useEffect(() => {
    if (focused) textareaRef.current?.focus();
    else textareaRef.current?.blur();
  }, [focused]);

  const setCursorAfterValueChange = useCallback(
    (nextValue: string, stringIndex: number) => {
      const position = stringIndexToCharacterIndex(nextValue, stringIndex);
      paintCannon.requestAnimationFrame(() => {
        if (textareaRef.current) textareaRef.current.cursorPosition = position;
      });
    },
    [paintCannon],
  );

  return (
    <Div
      style={{
        display: "flex",
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        flexDirection: "column",
      }}
    >
      {(attachedImages.length > 0 || showLoadingImageBadge) && (
        <Div
          style={{
            display: "flex",
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 1,
          }}
        >
          {attachedImages.map((_, index) => (
            <Span
              key={`image-badge-${index}`}
              style={{ color: "#111827", backgroundColor: "#e5e7eb" }}
            >
              {getImageBadgeText(index)}
            </Span>
          ))}
          {showLoadingImageBadge && (
            <Span style={{ color: "#111827", backgroundColor: "#e5e7eb" }}>
              {LOADING_BADGE_TEXT}
            </Span>
          )}
        </Div>
      )}
      <Textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder}
        autoFocus={focused}
        onChange={event => onChange(event.target.value)}
        onPaste={event => {
          const files = Array.from(event.clipboardData.files);
          if (files.length > 0) {
            event.preventDefault();
            void onImageFilesAttached?.(files);
          }
        }}
        onKeyDown={event => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;

          const textarea = textareaRef.current;
          if (!textarea) return;

          if ((event.ctrlKey && event.key === "p") || event.key === "Tab") {
            event.preventDefault();
            return;
          }

          const cursorPosition = characterIndexToStringIndex(value, textarea.cursorPosition);
          if (inputMode.kind === "vim") {
            const cursorVisualPosition = textarea.getCursorVisualPosition();
            const nativeVisualLineRange =
              cursorVisualPosition === null
                ? null
                : textarea.getVisualLineRange(cursorVisualPosition.row);
            const visualLineRange =
              nativeVisualLineRange === null
                ? null
                : {
                    start: characterIndexToStringIndex(value, nativeVisualLineRange.start),
                    end: characterIndexToStringIndex(value, nativeVisualLineRange.end),
                  };
            if (
              inputMode.mode === "NORMAL" &&
              (event.key === "j" ||
                event.key === "ArrowDown" ||
                event.key === "k" ||
                event.key === "ArrowUp")
            ) {
              event.preventDefault();
              textarea.moveCursorVertically(
                event.key === "j" || event.key === "ArrowDown" ? 1 : -1,
              );
              return;
            }

            const vimResult = vimHandler.handle(
              event.key,
              event,
              cursorPosition,
              value.length,
              value,
              cursorVisualPosition,
              visualLineRange,
            );
            if (vimResult.consumed) {
              event.preventDefault();
              const nextValue = vimResult.newValue ?? value;
              if (vimResult.newValue !== undefined) onChange(nextValue);
              if (vimResult.newCursorPosition !== undefined) {
                const position = stringIndexToCharacterIndex(
                  nextValue,
                  vimResult.newCursorPosition,
                );
                if (vimResult.newValue === undefined) {
                  textarea.cursorPosition = position;
                } else {
                  setCursorAfterValueChange(nextValue, vimResult.newCursorPosition);
                }
              }
              return;
            }
          }

          if (event.key === "Enter") {
            if (inputMode.kind === "vim" && inputMode.mode === "INSERT") return;
            event.preventDefault();
            onSubmit?.(value);
            return;
          }

          if (
            event.key === "Backspace" &&
            textarea.cursorPosition === 0 &&
            attachedImages.length > 0
          ) {
            event.preventDefault();
            onRemoveLastImage?.();
            return;
          }
        }}
        style={{
          display: "flex",
          width: "100%",
          minWidth: 0,
          minHeight: 1,
          flexGrow: 1,
          whiteSpace: "pre-wrap",
          color: FOREGROUND_COLOR,
          placeholderColor: "gray",
          overflowY: "visible",
        }}
      />
    </Div>
  );
}
