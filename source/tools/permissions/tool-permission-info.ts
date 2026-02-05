import { ToolCallRequest } from "../../ir/llm-ir.ts";
import { TOOL_CATEGORIES, CategoryArgsMap } from "../tool-defs/categories.ts";
import { categoryConfigs, WhitelistCategory, WhitelistCategoryData } from "./merged-whitelist.ts";
import { LabelContext, CategoryConfig } from "./category-whitelist-types.ts";
import { FileOperationArgs } from "../tool-defs/file-operations/index.ts";
import { McpArgs } from "../tool-defs/mcp/index.ts";
import { CommandArgs } from "../tool-defs/command/index.ts";
import { FetchArgs } from "../tool-defs/fetch/index.ts";
import { SkillArgs } from "../tool-defs/skill/index.ts";
import { Transport } from "../../transports/transport-common.ts";

export type ToolPermissionInfo = {
  category: WhitelistCategory;
  whitelistKey: string;
  label: string;
  labelParts: { text: string; bold?: boolean }[];
};

type AnyToolArgs = CategoryArgsMap[keyof CategoryArgsMap];

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
