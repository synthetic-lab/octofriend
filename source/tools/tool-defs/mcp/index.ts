export { default as mcp } from "./mcp.ts";

import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

const MCP_TOOL_SEPARATOR = ":";
const MCP_TOOL_WILDCARD_SUFFIX = ":*";

export type McpWhitelist = Set<string>;

export type McpArgs = { tool: string };

export function extractMcpPattern(toolName: string): string {
  const trimmed = toolName.trim();
  const colonIndex = trimmed.indexOf(MCP_TOOL_SEPARATOR);
  if (colonIndex > 0) {
    const server = trimmed.slice(0, colonIndex);
    return server + MCP_TOOL_WILDCARD_SUFFIX;
  }
  return trimmed;
}

export async function addToWhitelist(
  whitelist: McpWhitelist,
  whitelistKey: string,
): Promise<McpWhitelist> {
  const trimmed = whitelistKey.trim();
  if (!trimmed) return whitelist;
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(trimmed);
  return newWhitelist;
}

export async function isWhitelisted(
  whitelist: McpWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  const trimmed = whitelistKey.trim();
  for (const pattern of whitelist) {
    if (pattern.endsWith(MCP_TOOL_WILDCARD_SUFFIX)) {
      const server = pattern.slice(0, -2);
      if (trimmed.startsWith(server + MCP_TOOL_SEPARATOR)) {
        return true;
      }
    } else if (trimmed === pattern) {
      return true;
    }
  }
  return false;
}

export const config: CategoryConfig<McpWhitelist, McpArgs> = {
  getPermissionWhitelistKey: (toolName, args) => `${toolName}:${extractMcpPattern(args.tool)}`,
  formatLabelParts: (whitelistKey: string, _context) => [
    { text: "MCP tools matching " },
    { text: whitelistKey.split(":", 2)[1] || "", bold: true },
  ],
  addToWhitelist,
  isWhitelisted,
};
