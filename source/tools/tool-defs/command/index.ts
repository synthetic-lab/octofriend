export { default as shell } from "./shell.ts";

import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

export type CommandWhitelist = Set<string>;

export type CommandArgs = { cmd: string };

export async function addToWhitelist(
  whitelist: CommandWhitelist,
  whitelistKey: string,
): Promise<CommandWhitelist> {
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(whitelistKey);
  return newWhitelist;
}

export async function isWhitelisted(
  whitelist: CommandWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  // TODO: steph - add support for checking whitelist by piping a request to the agent
  // for now isWhitelisted will always be false.
  return false;
}

export const config: CategoryConfig<CommandWhitelist, CommandArgs> = {
  getPermissionWhitelistKey: async (toolName, args) => `${toolName}:${args.cmd}`,
  addToWhitelist,
  isWhitelisted,
};
