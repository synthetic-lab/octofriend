import React, { useCallback, useEffect, useRef } from "react";
import type { PaintFile, TextAreaElement } from "paintcannon";
import { Div, Span, Textarea, useApp } from "paintcannon-react";
import { useVimKeyHandler } from "./vim-mode.tsx";
import { ImageInfo } from "../utils/image-utils.ts";
import { useScrollTranscriptToBottom } from "../transcript-scroll.ts";

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
  readonly vimEnabled?: boolean;
  readonly vimMode?: "NORMAL" | "INSERT";
  readonly setVimMode?: (mode: "NORMAL" | "INSERT") => void;
  readonly attachedImages?: ImageInfo[];
  readonly onRemoveLastImage?: () => unknown;
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
  vimEnabled = false,
  vimMode = "NORMAL",
  setVimMode,
}: Props) {
  const { paintCannon } = useApp();
  const textareaRef = useRef<TextAreaElement>(null);
  const vimHandler = useVimKeyHandler(vimMode, setVimMode ?? (() => {}));
  const scrollTranscriptToBottom = useScrollTranscriptToBottom();

  useEffect(() => {
    if (focus) textareaRef.current?.focus();
    else textareaRef.current?.blur();
  }, [focus]);

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
        autoFocus={focus}
        onChange={event => onChange(event.target.value)}
        onPaste={event => {
          const files = Array.from(event.clipboardData.files);
          if (files.length > 0) {
            event.preventDefault();
            void onImageFilesAttached?.(files);
          }
        }}
        onKeyDown={event => {
          const hasModifier = event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;
          const scrolledTranscript =
            (event.key === "Enter" || !hasModifier) && scrollTranscriptToBottom();
          if (event.key === "Enter" && scrolledTranscript) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }

          const textarea = textareaRef.current;
          if (!textarea) return;

          if ((event.ctrlKey && event.key === "p") || event.key === "Tab") {
            event.preventDefault();
            return;
          }

          const cursorPosition = characterIndexToStringIndex(value, textarea.cursorPosition);
          if (vimEnabled) {
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
              vimMode === "NORMAL" &&
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
            if (vimEnabled && vimMode === "INSERT") return;
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
          color: "white",
          placeholderColor: "gray",
          overflowY: "visible",
        }}
      />
    </Div>
  );
}
