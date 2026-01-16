export { default as shell } from "./shell.ts";

import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

export type CommandWhitelist = Set<string>;

export type CommandArgs = { cmd: string };

export function extractCommandPrefix(fullCommand: string): string {
  const trimmed = fullCommand.trim();
  const firstSpaceIndex = trimmed.indexOf(" ");
  if (firstSpaceIndex === -1) {
    return trimmed;
  }

  const secondSpaceIndex = trimmed.indexOf(" ", firstSpaceIndex + 1);
  if (secondSpaceIndex > 0) {
    return trimmed.slice(0, secondSpaceIndex);
  }
  return trimmed;
}

export async function addToWhitelist(
  whitelist: CommandWhitelist,
  whitelistKey: string,
): Promise<CommandWhitelist> {
  const trimmed = whitelistKey.trim();
  if (!trimmed) return whitelist;
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(trimmed);
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
  getPermissionWhitelistKey: (toolName, args) => `${toolName}:${extractCommandPrefix(args.cmd)}`,
  formatLabelParts: (whitelistKey: string, _context) => [
    { text: "commands starting with " },
    { text: whitelistKey.split(":", 2)[1] || "", bold: true },
  ],
  addToWhitelist,
  isWhitelisted,
};
