import React from "react";

export const THEME_COLOR = "#72946d";
export const UNCHAINED_COLOR = "#AA0A0A";
export const DIFF_REMOVED = "#880808";
export const DIFF_ADDED = "#405e35";
export const DIFF_HEADER_COLOR = "gray";
export const DIFF_MARKER_COLOR = "black";
export const CODE_GUTTER_COLOR = "gray";
export const BACKGROUND_COLOR = "#0f172a";
export const FOREGROUND_COLOR = "#a3a3a3";
export const SCROLLBAR_COLOR = "#64748b #1e293b";
export const SUBTLE_SCROLLBAR_COLOR = "#475569 #1e293b";
export const APP_OVERLAY_Z_INDEX = 2147483647;
export const MARKDOWN_BLOCKQUOTE_BORDER_COLOR = "gray";
export const MARKDOWN_CODE_BLOCK_BORDER_COLOR = "gray";
export const MARKDOWN_HEADING_COLORS = [
  "#d4d4d4",
  "#c8c8c8",
  "#bfc3c7",
  "#b9b8c0",
  "#b5b0bb",
  "#afa9b5",
] as const;
export const MARKDOWN_INLINE_CODE_FOREGROUND_COLOR = "#b8c2d1";
export const MARKDOWN_INLINE_CODE_BACKGROUND_COLOR = "#182b42";
export const MARKDOWN_STRIKETHROUGH_COLOR = "gray";
export const MARKDOWN_HORIZONTAL_RULE_COLOR = "gray";
export const MARKDOWN_IMAGE_COLOR = "yellow";
export const MARKDOWN_LINK_COLOR = "blue";
export const MARKDOWN_LIST_MARKER_COLOR = "cyan";
export const MARKDOWN_CHECKED_TASK_COLOR = "green";
export const MARKDOWN_UNCHECKED_TASK_COLOR = "gray";
export const MARKDOWN_TABLE_BORDER_COLOR = "gray";
export const MARKDOWN_TABLE_HEADER_COLOR = "cyan";
export const MARKDOWN_TABLE_CELL_COLOR = "white";
export const SYNTAX_KEYWORD_COLOR = "blue";
export const SYNTAX_STRING_COLOR = "green";
export const SYNTAX_COMMENT_COLOR = "gray";
export const SYNTAX_NUMBER_COLOR = "yellow";
export const SYNTAX_TITLE_COLOR = "cyan";
export const SYNTAX_VARIABLE_COLOR = "magenta";
export const SYNTAX_TYPE_COLOR = "blue";
export const SYNTAX_ATTRIBUTE_COLOR = "yellow";
export const SYNTAX_BUILT_IN_COLOR = "red";
export const SYNTAX_LITERAL_COLOR = "cyan";
export const SYNTAX_NAME_COLOR = "cyan";
export const SYNTAX_SELECTOR_TAG_COLOR = "blue";
export const SYNTAX_SELECTOR_CLASS_COLOR = "yellow";
export const SYNTAX_SELECTOR_ID_COLOR = "magenta";
export const SYNTAX_PROPERTY_COLOR = "cyan";
export const SYNTAX_VALUE_COLOR = "green";

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
