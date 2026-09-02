export type VimMode = "NORMAL" | "INSERT";

export type InputMode = { kind: "emacs" } | { kind: "vim"; mode: VimMode };

export const DEFAULT_INPUT_MODE: InputMode = { kind: "emacs" };
