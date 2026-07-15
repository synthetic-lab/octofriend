import React from "react";

export const THEME_COLOR = "#72946d";
export const UNCHAINED_COLOR = "#AA0A0A";
export const DIFF_REMOVED = "#880808";
export const DIFF_ADDED = "#405e35";
export const CODE_GUTTER_COLOR = "gray";
export const BACKGROUND_COLOR = "#0f172a";
export const FOREGROUND_COLOR = "#a3a3a3";
export const SCROLLBAR_COLOR = "#64748b #1e293b";
export const SUBTLE_SCROLLBAR_COLOR = "#475569 #1e293b";
export const APP_OVERLAY_Z_INDEX = 2147483647;

export function color(unchained: boolean) {
  if (unchained) return UNCHAINED_COLOR;
  return THEME_COLOR;
}

export const UnchainedContext = React.createContext<boolean>(false);

export function useUnchained() {
  return React.useContext(UnchainedContext);
}

export function useColor() {
  const unchained = useUnchained();
  return color(unchained);
}
