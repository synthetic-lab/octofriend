import * as toolMap from "./index.ts";

export const TOOL_CATEGORIES = {
  filePattern: ['edit', 'create', 'append', 'prepend', 'rewrite', 'read', 'list'] as const,
  command: ['shell'] as const,
  mcpTool: ['mcp'] as const,
  fetch: ['fetch'] as const,
  skill: ['skill'] as const,
} as const;

type AllCategorizedTools = typeof TOOL_CATEGORIES[keyof typeof TOOL_CATEGORIES][number];
type AllExportedTools = keyof typeof toolMap;

type _CheckAllToolsCategorized = AllExportedTools extends AllCategorizedTools ? true : never;
type _CheckNoExtraCategories = AllCategorizedTools extends AllExportedTools ? true : never;
