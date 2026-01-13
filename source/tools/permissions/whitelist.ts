import { minimatch } from "minimatch";

import { PermissionsData, WhitelistType } from "./index.ts";
import { TOOL_CATEGORIES } from "../tool-defs/categories.ts";

export function createWhitelist(): PermissionsData {
  const whitelist = {} as PermissionsData;
  for (const category of Object.keys(TOOL_CATEGORIES) as WhitelistType[]) {
    whitelist[category] = new Set<string>();
  }
  return whitelist;
}

export const PATTERNS = {
  WILDCARD: "*",
  MCP_TOOL_SEPARATOR: ":",
  MCP_TOOL_WILDCARD_SUFFIX: ":*",
  FILE_PATH_SEPARATOR: "/",
} as const;

export const whitelistValidators = {
  command: (value: string, pattern: string) => {
    return value.startsWith(pattern);
  },
  fileOperations: (value: string, pattern: string) => {
    return minimatch(value, pattern) || minimatch(value.split(PATTERNS.FILE_PATH_SEPARATOR).pop() || "", pattern);
  },
  mcp: (value: string, pattern: string) => {
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
        if (whitelistValidators.command(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'fileOperations': {
      for (const pattern of whitelist.fileOperations) {
        if (whitelistValidators.fileOperations(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'mcp': {
      for (const pattern of whitelist.mcp) {
        if (whitelistValidators.mcp(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'fetch': {
      for (const pattern of whitelist.fetch) {
        if (whitelistValidators.fetch(trimmed, pattern)) {
          return true;
        }
      }
      return false;
    }
    case 'skill': {
      for (const pattern of whitelist.skill) {
        if (whitelistValidators.skill(trimmed, pattern)) {
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
    fileOperations: new Set(whitelist.fileOperations),
    mcp: new Set(whitelist.mcp),
    fetch: new Set(whitelist.fetch),
    skill: new Set(whitelist.skill),
  };
  newWhitelist[tool.type].add(trimmed);
  return newWhitelist;
}

export function extractCommandPrefix(fullCommand: string): string {
  const trimmed = fullCommand.trim();
  const firstSpaceIndex = trimmed.indexOf(' ');
  if (firstSpaceIndex === -1) {
    return trimmed;
  }

  const secondSpaceIndex = trimmed.indexOf(' ', firstSpaceIndex + 1);
  if (secondSpaceIndex > 0) {
    return trimmed.slice(0, secondSpaceIndex);
  }
  return trimmed;
}

export function extractMcpPattern(toolName: string): string {
  const trimmed = toolName.trim();
  const colonIndex = trimmed.indexOf(PATTERNS.MCP_TOOL_SEPARATOR);
  if (colonIndex > 0) {
    const server = trimmed.slice(0, colonIndex);
    return server + PATTERNS.MCP_TOOL_WILDCARD_SUFFIX;
  }
  return trimmed;
}
