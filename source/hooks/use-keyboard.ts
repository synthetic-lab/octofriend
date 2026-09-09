import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { PaintKeyboardEvent } from "paintcannon";
import { Div } from "paintcannon-react";
import { registry } from "antipattern";
import { useInputFocus } from "./use-input-focus.tsx";

export const KEYBOARD_PRIORITY = {
  OBSERVER: Infinity,
  OVERLAY: 1,
  DEFAULT: 0,
  FALLBACK: -1,
} as const;

type KeyboardListener = (event: PaintKeyboardEvent) => void;
type KeyboardOptions = {
  isActive?: boolean;
  priority?: number;
};
type KeyboardRegistration = {
  listener: KeyboardListener;
  priority: number;
};
type KeyboardContextValue = {
  register: (listener: KeyboardListener, priority: number) => () => void;
};

const KeyboardContext = React.createContext<KeyboardContextValue | null>(null);

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef(new Set<KeyboardRegistration>());
  const register = useCallback((listener: KeyboardListener, priority: number) => {
    const registration = { listener, priority };
    listenersRef.current.add(registration);
    return () => listenersRef.current.delete(registration);
  }, []);
  const context = useMemo(() => ({ register }), [register]);
  const handleKeyDown = useCallback((event: PaintKeyboardEvent) => {
    const listeners = Array.from(listenersRef.current).sort((a, b) => b.priority - a.priority);
    for (const { listener } of listeners) {
      listener(event);
      if (event.propagationStopped) break;
    }
  }, []);

  return React.createElement(
    KeyboardContext.Provider,
    { value: context },
    React.createElement(
      Div,
      {
        onKeyDown: handleKeyDown,
        style: {
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
        },
      },
      children,
    ),
  );
}

function useKeyboardImpl(
  callback: KeyboardListener,
  isActive = true,
  priority: number = KEYBOARD_PRIORITY.DEFAULT,
): void {
  const context = useContext(KeyboardContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!isActive) return;
    if (!context) throw new Error("useKeyboard must be used inside KeyboardProvider");

    const handleKeyDown = (event: PaintKeyboardEvent) => {
      callbackRef.current(event);
    };
    return context.register(handleKeyDown, priority);
  }, [context, isActive, priority]);
}

export const keyboardDeps = registry({
  useKeyboard: useKeyboardImpl,
});

export function useKeyboard(
  callback: KeyboardListener,
  { isActive = true, priority = KEYBOARD_PRIORITY.DEFAULT }: KeyboardOptions = {},
): void {
  keyboardDeps.useKeyboard(callback, useInputFocus(isActive), priority);
}
