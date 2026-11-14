import toolMap from "./tool-defs/index.ts";
import {
  LoadedTools as GenericLoadedTools,
  ToolCall as GenericToolCall,
} from "../libocto/tools/tool-def.ts";

export type LoadedTools = GenericLoadedTools<typeof toolMap>;
export type ToolCall = GenericToolCall<typeof toolMap>;

export const SKIP_CONFIRMATION_TOOLS: Array<keyof LoadedTools> = [
  "read",
  "partial-read",
  "list",
  "skill",
  "web-search",
  "fetch",
  "web-research",
  "glob",
  "grep",
  "explore",
  "lsp-definition",
  "lsp-references",
  "lsp-hover",
  "lsp-diagnostics",
  "lsp-document-symbol",
  "lsp-implementation",
  "lsp-incoming-calls",
  "lsp-outgoing-calls",
  "manage-background-process",
];

export const ALWAYS_REQUEST_PERMISSION_TOOLS: Array<keyof LoadedTools> = [
  "shell",
  "background-process",
];
