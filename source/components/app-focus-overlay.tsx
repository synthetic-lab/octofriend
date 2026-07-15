import React, { useEffect, useState } from "react";
import { Div, useApp } from "paintcannon-react";

const DIMMED_OPACITY = 0.4;
const DIM_TRANSITION = "opacity 100ms";

function FocusDimmer() {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    setOpacity(DIMMED_OPACITY);
  }, []);

  return (
    <Div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: 2147483647,
        backgroundColor: "black",
        opacity,
        transition: DIM_TRANSITION,
      }}
    />
  );
}

export function AppFocusOverlay({ children }: { children: React.ReactNode }) {
  const { paintCannon } = useApp();
  const [hasFocus, setHasFocus] = useState(paintCannon.hasFocus);

  useEffect(() => {
    const handleBlur = () => setHasFocus(false);
    const handleFocus = () => setHasFocus(true);

    paintCannon.addEventListener("blur", handleBlur);
    paintCannon.addEventListener("focus", handleFocus);
    return () => {
      paintCannon.removeEventListener("blur", handleBlur);
      paintCannon.removeEventListener("focus", handleFocus);
    };
  }, [paintCannon]);

  return (
    <>
      {children}
      {!hasFocus && <FocusDimmer />}
    </>
  );
}
