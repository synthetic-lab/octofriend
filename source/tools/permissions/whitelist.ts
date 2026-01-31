import {
  createMergedWhitelist,
  addToMergedWhitelist,
  isWhitelistedInCategory,
  WhitelistCategory,
  MergedWhitelist,
} from "./merged-whitelist.ts";

export function createWhitelist(): MergedWhitelist {
  return createMergedWhitelist();
}

export async function isWhitelisted(
  whitelist: MergedWhitelist,
  category: WhitelistCategory,
  whitelistKey: string,
): Promise<boolean> {
  return await isWhitelistedInCategory(whitelist, category, whitelistKey);
}

export async function addToWhitelist(
  whitelist: MergedWhitelist,
  category: WhitelistCategory,
  whitelistKey: string,
): Promise<MergedWhitelist> {
  return await addToMergedWhitelist(whitelist, category, whitelistKey);
}
