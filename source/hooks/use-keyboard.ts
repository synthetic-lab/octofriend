import { useEffect, useRef } from "react";
import type { PaintKeyboardEvent } from "paintcannon";
import { useApp } from "paintcannon-react";

export function useKeyboard(callback: (event: PaintKeyboardEvent) => void, isActive = true): void {
  const { paintCannon } = useApp();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (event: PaintKeyboardEvent) => {
      callbackRef.current(event);
    };
    paintCannon.addEventListener("keydown", handleKeyDown);
    return () => paintCannon.removeEventListener("keydown", handleKeyDown);
  }, [isActive, paintCannon]);
}
