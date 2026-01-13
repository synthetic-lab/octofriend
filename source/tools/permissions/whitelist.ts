import { minimatch } from "minimatch";

import { PermissionsData, WhitelistType } from "./index.ts";

export function createWhitelist(): PermissionsData {
  return {
    command: new Set<string>(),
    filePattern: new Set<string>(),
    mcpTool: new Set<string>(),
    fetch: new Set<string>(),
    skill: new Set<string>(),
  };
}

export const PATTERNS = {
  WILDCARD: "*",
  MCP_TOOL_SEPARATOR: ":",
  MCP_TOOL_WILDCARD_SUFFIX: ":*",
  FILE_PATH_SEPARATOR: "/",
} as const;

export const matchers = {
  command: (value: string, pattern: string) => {
    return value.startsWith(pattern);
  },

  filePattern: (value: string, pattern: string) => {
    return minimatch(value, pattern) || minimatch(value.split(PATTERNS.FILE_PATH_SEPARATOR).pop() || "", pattern);
  },

  mcpTool: (value: string, pattern: string) => {
    if (pattern.endsWith(PATTERNS.MCP_TOOL_WILDCARD_SUFFIX)) {
      const server = pattern.slice(0, -2);
      return value.startsWith(server + PATTERNS.MCP_TOOL_SEPARATOR);
    }
    return value === pattern;
  },

  fetch: (value: string, pattern: string) => {
    return pattern === PATTERNS.WILDCARD || value === pattern;
  },

  skill: (value: string, pattern: string) => {
    return pattern === PATTERNS.WILDCARD || value === pattern;
  },
} as const;

export function isWhitelisted(
  whitelist: PermissionsData,
  tool: { type: WhitelistType; value: string }
): boolean {
  const trimmed = tool.value.trim();

  switch (tool.type) {
    case 'command': {
      for (const pattern of whitelist.command) {
        if (matchers.command(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'filePattern': {
      for (const pattern of whitelist.filePattern) {
        if (matchers.filePattern(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'mcpTool': {
      for (const pattern of whitelist.mcpTool) {
        if (matchers.mcpTool(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'fetch': {
      for (const pattern of whitelist.fetch) {
        if (matchers.fetch(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'skill': {
      for (const pattern of whitelist.skill) {
        if (matchers.skill(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
  }
}

export function addToWhitelist(
  whitelist: PermissionsData,
  tool: { type: WhitelistType; pattern: string }
): PermissionsData {
  const trimmed = tool.pattern.trim();
  if (!trimmed) return whitelist;
  const newWhitelist = {
    command: new Set(whitelist.command),
    filePattern: new Set(whitelist.filePattern),
    mcpTool: new Set(whitelist.mcpTool),
    fetch: new Set(whitelist.fetch),
    skill: new Set(whitelist.skill),
  };
  newWhitelist[tool.type].add(trimmed);
  return newWhitelist;
}

export function extractCommandPrefix(fullCommand: string): string {
  const trimmed = fullCommand.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex > 0) {
    return trimmed.slice(0, spaceIndex);
  }
  return trimmed;
}

export function extractMcpToolPattern(toolName: string): string {
  const trimmed = toolName.trim();
  const colonIndex = trimmed.indexOf(PATTERNS.MCP_TOOL_SEPARATOR);
  if (colonIndex > 0) {
    const server = trimmed.slice(0, colonIndex);
    return server + PATTERNS.MCP_TOOL_WILDCARD_SUFFIX;
  }
  return trimmed;
}
