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

export async function isWhitelisted(
  whitelist: SkillWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  const trimmed = whitelistKey.trim();
  for (const pattern of whitelist) {
    if (pattern === WILDCARD || trimmed === pattern) {
      return true;
    }
  }
  return false;
}

export const config: CategoryConfig<SkillWhitelist, SkillArgs> = {
  getPermissionWhitelistKey: (toolName, _args) => `${toolName}:${WILDCARD}`,
  formatLabelParts: (whitelistKey: string, _context) => {
    const domain = whitelistKey.split(":", 2)[1] || "";
    return [{ text: "skill execution" }];
  },
  addToWhitelist,
  isWhitelisted,
};
