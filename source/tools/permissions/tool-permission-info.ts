import { CategoryArgsMap } from "../tool-defs/categories.ts";
import { categoryConfigs, WhitelistCategory, WhitelistCategoryData } from "./merged-whitelist.ts";
import { CategoryConfig } from "./category-whitelist-types.ts";
export type ToolPermissionInfo = {
  category: WhitelistCategory;
  whitelistKey: string;
  permissionContext: string;
};

export async function getPermissionContext<T extends WhitelistCategory>(
  category: T,
  args: CategoryArgsMap[T],
): Promise<string> {
  const config = categoryConfigs[category] as CategoryConfig<
    WhitelistCategoryData,
    CategoryArgsMap[T]
  >;
  return config.getPermissionContext?.(args) ?? "";
}

export async function getPermissionWhitelistKey<T extends WhitelistCategory>(
  category: T,
  toolName: string,
  args: CategoryArgsMap[T],
): Promise<string> {
  const config = categoryConfigs[category] as CategoryConfig<
    WhitelistCategoryData,
    CategoryArgsMap[T]
  >;
  return config.getPermissionWhitelistKey(toolName, args);
}
