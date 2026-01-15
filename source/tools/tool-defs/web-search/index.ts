export { default as webSearch } from "./web-search.ts";

import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

export type WebSearchWhiteList = Set<string>;

export type WebSearchArgs = {};

export async function addToWhitelist(
  whitelist: WebSearchWhiteList,
  whitelistKey: string,
): Promise<WebSearchWhiteList> {
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(whitelistKey);
  return newWhitelist;
}

export async function isWhitelisted(): Promise<boolean> {
  return true;
}

export const config: CategoryConfig<WebSearchWhiteList, WebSearchArgs> = {
  getPermissionWhitelistKey: async () => "web-search",
  yesAndAlwaysAllowLabelSuffix: () => [{ text: "Web Searches" }],
  addToWhitelist,
  isWhitelisted,
};
