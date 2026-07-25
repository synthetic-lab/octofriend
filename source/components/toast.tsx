import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAnimation } from "paintcannon-react";
import { TerminalFlex } from "./terminal-flex.tsx";
import { MODAL_Z_INDEX, BACKGROUND_COLOR, THEME_COLOR } from "../theme.ts";

export const DEFAULT_TOAST_DURATION_MS = 5000;
const TOAST_SLIDE_DURATION_MS = 300;
const TOAST_RESTING_RIGHT = 2;
const TOAST_MAX_WIDTH = 80;
const TOAST_STARTING_RIGHT = -(TOAST_MAX_WIDTH + TOAST_RESTING_RIGHT * 2);

export type ToastOptions = {
  durationMs?: number;
};

export type ToastFn = (children: React.ReactNode, options?: ToastOptions) => void;

type ToastPhase = "entering" | "fully-visible" | "exiting";

type ToastState = {
  id: number;
  children: React.ReactNode;
  visibilityDurationMs: number;
  phase: ToastPhase;
};

function getNextToastState(toast: ToastState | null): ToastState | null {
  if (!toast) return null;
  switch (toast.phase) {
    case "entering":
      return { ...toast, phase: "fully-visible" };
    case "fully-visible":
      return { ...toast, phase: "exiting" };
    case "exiting":
      return null;
  }
}

const ToastContext = createContext<ToastFn | null>(null);

export function Toast({ children, phase }: { children: React.ReactNode; phase: ToastPhase }) {
  const { time } = useAnimation({ isActive: phase !== "fully-visible" });
  const progress = Math.min(1, time / TOAST_SLIDE_DURATION_MS);
  const easedProgress = phase === "exiting" ? Math.pow(progress, 3) : 1 - Math.pow(1 - progress, 3);
  const startRight = phase === "entering" ? TOAST_STARTING_RIGHT : TOAST_RESTING_RIGHT;
  const endRight = phase === "exiting" ? TOAST_STARTING_RIGHT : TOAST_RESTING_RIGHT;
  const right =
    phase === "fully-visible"
      ? TOAST_RESTING_RIGHT
      : Math.round(startRight + (endRight - startRight) * easedProgress);

  return (
    <TerminalFlex
      style={{
        position: "absolute",
        top: 1,
        right,
        zIndex: MODAL_Z_INDEX,
        flexDirection: "column",
        maxWidth: TOAST_MAX_WIDTH,
        paddingLeft: 1,
        paddingRight: 1,
        border: "rounded",
        borderColor: THEME_COLOR,
        backgroundColor: BACKGROUND_COLOR,
        overflowWrap: "anywhere",
      }}
    >
      {children}
    </TerminalFlex>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const nextToastId = useRef(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const showToast = useCallback<ToastFn>((children, options) => {
    setToast({
      id: nextToastId.current++,
      children,
      visibilityDurationMs: options?.durationMs ?? DEFAULT_TOAST_DURATION_MS,
      phase: "entering",
    });
  }, []);

  useEffect(() => {
    if (toast == null) return;

    const timer = setTimeout(
      () => {
        setToast(currentToast => getNextToastState(currentToast));
      },
      toast.phase === "fully-visible" ? toast.visibilityDurationMs : TOAST_SLIDE_DURATION_MS,
    );

    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast != null && (
        <Toast key={toast.id} phase={toast.phase}>
          {toast.children}
        </Toast>
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastFn {
  const showToast = useContext(ToastContext);
  if (showToast == null) throw new Error("useToast must be used within a ToastProvider.");
  return showToast;
}
