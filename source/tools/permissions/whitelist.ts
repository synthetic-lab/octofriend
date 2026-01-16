import { PermissionsData, WhitelistType } from "./index.ts";
import {
  createMergedWhitelist,
  addToMergedWhitelist,
  isWhitelistedInCategory,
} from "./merged-whitelist.ts";

export function createWhitelist(): PermissionsData {
  return createMergedWhitelist();
}

export async function isWhitelisted(
  whitelist: PermissionsData,
  tool: { type: WhitelistType; value: string },
): Promise<boolean> {
  return await isWhitelistedInCategory(whitelist, tool.type, tool.value);
}

export async function addToWhitelist(
  whitelist: PermissionsData,
  tool: { type: WhitelistType; pattern: string },
): Promise<PermissionsData> {
  const trimmed = tool.pattern.trim();
  if (!trimmed) return whitelist;
  return await addToMergedWhitelist(whitelist, tool.type, trimmed);
}
