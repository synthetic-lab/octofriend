export { default as fetch } from "./fetch.ts";

import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

export type FetchWhitelist = Set<string>;

export type FetchArgs = { url: string };

export async function addToWhitelist(
  whitelist: FetchWhitelist,
  whitelistKey: string,
): Promise<FetchWhitelist> {
  const trimmed = whitelistKey.trim();
  if (!trimmed) return whitelist;
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(trimmed);
  return newWhitelist;
}

export async function isWhitelisted(
  whitelist: FetchWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  return true;
}

export const config: CategoryConfig<FetchWhitelist, FetchArgs> = {
  getPermissionWhitelistKey: async (toolName, args) => {
    try {
      const url = new URL(args.url);
      return `${toolName}:${url.hostname}`;
    } catch {
      return `${toolName}:${args.url}`;
    }
  },
  yesAndAlwaysAllowLabelSuffix: (whitelistKey: string, _context) => {
    const domain = whitelistKey.split(":", 2)[1] || "";
    return [{ text: "fetches from " }, { text: domain, bold: true }];
  },
  addToWhitelist,
  isWhitelisted,
};
