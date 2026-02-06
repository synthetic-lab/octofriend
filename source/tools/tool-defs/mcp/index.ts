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
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(whitelistKey);
  return newWhitelist;
}

export async function isWhitelisted(
  whitelist: McpWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  for (const pattern of whitelist) {
    if (pattern.endsWith(MCP_TOOL_WILDCARD_SUFFIX)) {
      const server = pattern.slice(0, -2);
      if (whitelistKey.startsWith(server + MCP_TOOL_SEPARATOR)) {
        return true;
      }
    } else if (whitelistKey === pattern) {
      return true;
    }
  }
  return false;
}

export const config: CategoryConfig<McpWhitelist, McpArgs> = {
  getPermissionWhitelistKey: async (toolName, args) =>
    `${toolName}:${extractMcpPattern(args.tool)}`,
  addToWhitelist,
  isWhitelisted,
};
