import * as fileOperationsWhitelist from "../tool-defs/file-operations/index.ts";
import * as commandWhitelist from "../tool-defs/command/index.ts";
import * as mcpWhitelist from "../tool-defs/mcp/index.ts";
import * as fetchWhitelist from "../tool-defs/fetch/index.ts";
import * as skillWhitelist from "../tool-defs/skill/index.ts";

export type MergedWhitelist = {
  fileOperations: fileOperationsWhitelist.FileOperationsWhitelist;
  command: commandWhitelist.CommandWhitelist;
  mcp: mcpWhitelist.McpWhitelist;
  fetch: fetchWhitelist.FetchWhitelist;
  skill: skillWhitelist.SkillWhitelist;
};

export type WhitelistCategoryData = MergedWhitelist[keyof MergedWhitelist];

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
  whitelistKey: string,
): Promise<MergedWhitelist> {
  switch (category) {
    case "fileOperations":
      return {
        ...whitelist,
        fileOperations: await fileOperationsWhitelist.addToWhitelist(
          whitelist.fileOperations,
          whitelistKey,
        ),
      };
    case "command":
      return {
        ...whitelist,
        command: await commandWhitelist.addToWhitelist(whitelist.command, whitelistKey),
      };
    case "mcp":
      return {
        ...whitelist,
        mcp: await mcpWhitelist.addToWhitelist(whitelist.mcp, whitelistKey),
      };
    case "fetch":
      return {
        ...whitelist,
        fetch: await fetchWhitelist.addToWhitelist(whitelist.fetch, whitelistKey),
      };
    case "skill":
      return {
        ...whitelist,
        skill: await skillWhitelist.addToWhitelist(whitelist.skill, whitelistKey),
      };
  }
}

export async function isWhitelistedInCategory(
  whitelist: MergedWhitelist,
  category: WhitelistCategory,
  whitelistKey: string,
): Promise<boolean> {
  switch (category) {
    case "fileOperations":
      return await fileOperationsWhitelist.isWhitelisted(whitelist.fileOperations, whitelistKey);
    case "command":
      return await commandWhitelist.isWhitelisted(whitelist.command, whitelistKey);
    case "mcp":
      return await mcpWhitelist.isWhitelisted(whitelist.mcp, whitelistKey);
    case "fetch":
      return await fetchWhitelist.isWhitelisted(whitelist.fetch, whitelistKey);
    case "skill":
      return await skillWhitelist.isWhitelisted();
  }
}

export const categoryConfigs = {
  fileOperations: fileOperationsWhitelist.config,
  command: commandWhitelist.config,
  mcp: mcpWhitelist.config,
  fetch: fetchWhitelist.config,
  skill: skillWhitelist.config,
} as const;
