import { SKIP_CONFIRMATION_TOOLS } from "../index.ts";
import { MergedWhitelist, WhitelistCategory } from "./merged-whitelist.ts";

export type PermissionsData = MergedWhitelist;
export type WhitelistType = WhitelistCategory;

export function shouldSkipConfirmation(
  toolName: string,
  unchained: boolean,
  isWhitelisted: boolean,
): boolean {
  return unchained || SKIP_CONFIRMATION_TOOLS.includes(toolName) || isWhitelisted;
}

export { extractToolPermissionInfo } from "./tool-permission-info.ts";
export type { ToolPermissionInfo } from "./tool-permission-info.ts";
export { useToolPermissionInfo } from "./use-tool-permission-info.ts";
export type { FormatLabelContext, ContextProvider } from "./category-whitelist-types.ts";
