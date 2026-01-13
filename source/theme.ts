import React from "react";

export const THEME_COLOR = "#72946d";
export const UNCHAINED_COLOR = "#AA0A0A";
export const DIFF_REMOVED = "#880808";
export const DIFF_ADDED = "#405e35";
export const CODE_GUTTER_COLOR = "gray";

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
