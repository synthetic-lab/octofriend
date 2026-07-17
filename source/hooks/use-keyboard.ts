import React, { useCallback, useContext, useEffect, useMemo, useRef } from "react";
import type { PaintKeyboardEvent } from "paintcannon";
import { Div } from "paintcannon-react";
import { registry } from "antipattern";

type KeyboardListener = (event: PaintKeyboardEvent) => void;
type KeyboardContextValue = {
  register: (listener: KeyboardListener) => () => void;
};

const KeyboardContext = React.createContext<KeyboardContextValue | null>(null);

export function KeyboardProvider({ children }: { children: React.ReactNode }) {
  const listenersRef = useRef(new Set<KeyboardListener>());
  const register = useCallback((listener: KeyboardListener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);
  const context = useMemo(() => ({ register }), [register]);
  const handleKeyDown = useCallback((event: PaintKeyboardEvent) => {
    for (const listener of Array.from(listenersRef.current)) listener(event);
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

function useKeyboardImpl(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  const context = useContext(KeyboardContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!isActive) return;
    if (!context) throw new Error("useKeyboard must be used inside KeyboardProvider");

    const handleKeyDown = (event: PaintKeyboardEvent) => {
      callbackRef.current(event);
    };
    return context.register(handleKeyDown);
  }, [context, isActive]);
}

export const keyboardDeps = registry({
  useKeyboard: useKeyboardImpl,
});

export function useKeyboard(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  keyboardDeps.useKeyboard(callback, isActive);
}
