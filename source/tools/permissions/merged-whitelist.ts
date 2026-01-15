import * as fileOperationsWhitelist from "../tool-defs/file-operations/index.ts";
import * as commandWhitelist from "../tool-defs/command/index.ts";
import * as mcpWhitelist from "../tool-defs/mcp/index.ts";
import * as fetchWhitelist from "../tool-defs/fetch/index.ts";
import * as skillWhitelist from "../tool-defs/skill/index.ts";

export interface MergedWhitelist {
  fileOperations: fileOperationsWhitelist.FileOperationsWhitelist;
  command: commandWhitelist.CommandWhitelist;
  mcp: mcpWhitelist.McpWhitelist;
  fetch: fetchWhitelist.FetchWhitelist;
  skill: skillWhitelist.SkillWhitelist;
}

export type WhitelistCategory = keyof MergedWhitelist;

export function createMergedWhitelist(): MergedWhitelist {
  return {
    fileOperations: new Set<string>(),
    command: new Set<string>(),
    mcp: new Set<string>(),
    fetch: new Set<string>(),
    skill: new Set<string>(),
  };
}

export async function addToMergedWhitelist(
  whitelist: MergedWhitelist,
  category: WhitelistCategory,
  pattern: string,
): Promise<MergedWhitelist> {
  switch (category) {
    case "fileOperations":
      return {
        ...whitelist,
        fileOperations: await fileOperationsWhitelist.addToWhitelist(
          whitelist.fileOperations,
          pattern,
        ),
      };
    case "command":
      return {
        ...whitelist,
        command: await commandWhitelist.addToWhitelist(whitelist.command, pattern),
      };
    case "mcp":
      return {
        ...whitelist,
        mcp: await mcpWhitelist.addToWhitelist(whitelist.mcp, pattern),
      };
    case "fetch":
      return {
        ...whitelist,
        fetch: await fetchWhitelist.addToWhitelist(whitelist.fetch, pattern),
      };
    case "skill":
      return {
        ...whitelist,
        skill: await skillWhitelist.addToWhitelist(whitelist.skill, pattern),
      };
  }
}

export async function isWhitelistedInCategory(
  whitelist: MergedWhitelist,
  category: WhitelistCategory,
  value: string,
): Promise<boolean> {
  switch (category) {
    case "fileOperations":
      return await fileOperationsWhitelist.isWhitelisted(whitelist.fileOperations, value);
    case "command":
      return await commandWhitelist.isWhitelisted(whitelist.command, value);
    case "mcp":
      return await mcpWhitelist.isWhitelisted(whitelist.mcp, value);
    case "fetch":
      return await fetchWhitelist.isWhitelisted(whitelist.fetch, value);
    case "skill":
      return await skillWhitelist.isWhitelisted(whitelist.skill, value);
  }
}

export const categoryConfigs = {
  fileOperations: fileOperationsWhitelist.config,
  command: commandWhitelist.config,
  mcp: mcpWhitelist.config,
  fetch: fetchWhitelist.config,
  skill: skillWhitelist.config,
} as const;
