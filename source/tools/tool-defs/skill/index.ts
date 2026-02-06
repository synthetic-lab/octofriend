export { default as skill } from "./skill.ts";

import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

const WILDCARD = "*";

export type SkillWhitelist = Set<string>;

export type SkillArgs = { skillName: string };

export async function addToWhitelist(
  whitelist: SkillWhitelist,
  whitelistKey: string,
): Promise<SkillWhitelist> {
  const trimmed = whitelistKey.trim();
  if (!trimmed) return whitelist;
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(trimmed);
  return newWhitelist;
}

export async function isWhitelisted(): Promise<boolean> {
  return true;
}

export const config: CategoryConfig<SkillWhitelist, SkillArgs> = {
  getPermissionWhitelistKey: async (toolName, _args) => `${toolName}:${WILDCARD}`,
  addToWhitelist,
  isWhitelisted,
};
