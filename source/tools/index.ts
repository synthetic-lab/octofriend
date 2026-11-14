import type { octoAgent } from "../ir/octo-ir.ts";
import type { ToolRegistry, TreeToolCall } from "../libocto/index.ts";

export type OctoToolRegistry = ToolRegistry<typeof octoAgent>;
export type OctoToolCall = TreeToolCall<typeof octoAgent>;

export const SKIP_CONFIRMATION_TOOLS: Array<keyof OctoToolRegistry> = [
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

export const ALWAYS_REQUEST_PERMISSION_TOOLS: Array<keyof OctoToolRegistry> = [
  "shell",
  "background-process",
];
