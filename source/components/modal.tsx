import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DivElement } from "paintcannon";
import { useAnimation } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
import { FocusTrap } from "../hooks/use-keyboard.ts";
import { BACKGROUND_COLOR, DIMMED_BACKGROUND_COLOR, MODAL_Z_INDEX, useColor } from "../theme.ts";

const BACKDROP_OPACITY = 0.75;
const BACKDROP_FADE_DURATION_MS = 300;
const MODAL_SHOW_DELAY_MS = 150;
const MODAL_RESIZE_DURATION_MS = 200;

type Size = {
  width: number;
  height: number;
};

function fadeProgress(time: number, durationMs: number): number {
  return Math.min(1, time / durationMs);
}

export function Modal({
  children,
  minWidth = 0,
}: {
  children: React.ReactNode;
  minWidth?: number;
}) {
  const borderColor = useColor();
  const { time } = useAnimation({ isActive: true });
  const backdropOpacity = BACKDROP_OPACITY * fadeProgress(time, BACKDROP_FADE_DURATION_MS);
  const showBox = time >= MODAL_SHOW_DELAY_MS;

  const contentRef = useRef<DivElement>(null);
  const [sizeTarget, setSizeTarget] = useState<Size | null>(null);
  const [sizeAnim, setSizeAnim] = useState<{ from: Size; to: Size; startTime: number } | null>(
    null,
  );
  const resizeProgress = sizeAnim
    ? fadeProgress(time - sizeAnim.startTime, MODAL_RESIZE_DURATION_MS)
    : 1;
  useEffect(() => {
    if (sizeAnim != null && resizeProgress >= 1) setSizeAnim(null);
  }, [sizeAnim, resizeProgress]);
  const easedResizeProgress = 1 - Math.pow(1 - resizeProgress, 3);
  const displayedSize = (() => {
    if (sizeTarget == null) return null;
    if (sizeAnim == null) return sizeTarget;
    return {
      width: Math.round(
        sizeAnim.from.width + (sizeAnim.to.width - sizeAnim.from.width) * easedResizeProgress,
      ),
      height: Math.round(
        sizeAnim.from.height + (sizeAnim.to.height - sizeAnim.from.height) * easedResizeProgress,
      ),
    };
  })();
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (el == null) return;
    const measured = { width: el.clientWidth, height: el.clientHeight };
    if (measured.width === 0 || measured.height === 0) return;
    if (sizeTarget == null) {
      setSizeTarget(measured);
      return;
    }
    if (sizeTarget.width !== measured.width || sizeTarget.height !== measured.height) {
      setSizeAnim({ from: displayedSize ?? sizeTarget, to: measured, startTime: time });
      setSizeTarget(measured);
    }
  });

  return (
    <FocusTrap>
      <TerminalFlex
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
            opacity: backdropOpacity,
          }}
        />
        <TerminalFlex
          style={{
            position: "relative",
            zIndex: 1,
            flexDirection: "column",
            minWidth,
            maxWidth: "100%",
            maxHeight: "100%",
            visibility: showBox ? "visible" : "hidden",
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
              padding: 1,
              paddingLeft: 2,
              paddingRight: 2,
            }}
          >
            {children}
          </TerminalFlex>
        </TerminalFlex>
      </TerminalFlex>
    </FocusTrap>
  );
}
