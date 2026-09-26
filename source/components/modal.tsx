import React, { useLayoutEffect, useRef, useState } from "react";
import type { DivElement } from "paintcannon";
import { InputElement, TextAreaElement } from "paintcannon";
import { useAnimation } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
import { BACKGROUND_COLOR, DIMMED_BACKGROUND_COLOR, MODAL_Z_INDEX, useColor } from "../theme.ts";

const BACKDROP_FADE_DURATION_MS = 300;
const MODAL_SHOW_DELAY_MS = 150;
const MODAL_RESIZE_DURATION_MS = 200;

type Size = {
  width: number;
  height: number;
};

type ResizeAnimation = {
  from: Size;
  to: Size;
  startTime: number;
};

export function Modal({
  children,
  minWidth,
  onClose,
}: {
  children: React.ReactNode;
  minWidth: number;
  onClose: () => void;
}) {
  const borderColor = useColor();
  const { time } = useAnimation({ isActive: true });
  const contentRef = useRef<DivElement>(null);
  const [resizeAnimation, setResizeAnimation] = useState<ResizeAnimation | null>(null);
  const resizeProgress = resizeAnimation
    ? Math.min(1, (time - resizeAnimation.startTime) / MODAL_RESIZE_DURATION_MS)
    : 1;
  const easedResizeProgress = 1 - Math.pow(1 - resizeProgress, 3);
  const displayedSize = resizeAnimation && {
    width: Math.round(
      resizeAnimation.from.width +
        (resizeAnimation.to.width - resizeAnimation.from.width) * easedResizeProgress,
    ),
    height: Math.round(
      resizeAnimation.from.height +
        (resizeAnimation.to.height - resizeAnimation.from.height) * easedResizeProgress,
    ),
  };

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content == null) return;
    const measured = { width: content.clientWidth, height: content.clientHeight };
    if (measured.width === 0 || measured.height === 0) return;
    if (
      resizeAnimation == null ||
      resizeAnimation.to.width !== measured.width ||
      resizeAnimation.to.height !== measured.height
    ) {
      setResizeAnimation({ from: displayedSize ?? measured, to: measured, startTime: time });
    }
  });

  return (
    <TerminalFlex
      onKeyDown={event => {
        if (event.defaultPrevented) return;
        if (event.key === "Escape" || (event.ctrlKey && event.key === "c")) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          return;
        }
        if (event.target instanceof InputElement || event.target instanceof TextAreaElement) return;
        event.preventDefault();
      }}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: MODAL_Z_INDEX,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <TerminalFlex
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          backgroundColor: DIMMED_BACKGROUND_COLOR,
          opacity: 0.75 * Math.min(1, time / BACKDROP_FADE_DURATION_MS),
        }}
      />
      {time >= MODAL_SHOW_DELAY_MS && (
        <TerminalFlex
          style={{
            position: "relative",
            zIndex: 1,
            flexDirection: "column",
            minWidth,
            maxWidth: "100%",
            maxHeight: "100%",
          }}
        >
          {displayedSize != null && (
            <TerminalFlex
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: displayedSize.width,
                height: displayedSize.height,
                border: "rounded",
                borderColor,
                backgroundColor: BACKGROUND_COLOR,
              }}
            />
          )}
          <TerminalFlex
            ref={contentRef}
            style={{
              position: "relative",
              zIndex: 1,
              flexDirection: "column",
              minHeight: 0,
              maxHeight: "100%",
              padding: 1,
              paddingLeft: 2,
              paddingRight: 2,
            }}
          >
            {children}
          </TerminalFlex>
        </TerminalFlex>
      )}
    </TerminalFlex>
  );
}
