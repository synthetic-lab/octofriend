import { useEffect, useState } from "react";
import { useApp } from "paintcannon-react";

/** Whether the terminal currently has focus, refreshed live across focus/blur events. */
export function useTerminalFocus(): boolean {
  const { paintCannon } = useApp();
  const [hasFocus, setHasFocus] = useState(paintCannon.hasFocus);

  useEffect(() => {
    const onFocus = () => setHasFocus(true);
    const onBlur = () => setHasFocus(false);
    paintCannon.addEventListener("focus", onFocus);
    paintCannon.addEventListener("blur", onBlur);
    return () => {
      paintCannon.removeEventListener("focus", onFocus);
      paintCannon.removeEventListener("blur", onBlur);
    };
  }, [paintCannon]);

  return hasFocus;
}
