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

type AllToolsFromDefs = (typeof TOOL_CATEGORIES)[keyof typeof TOOL_CATEGORIES][number];

type ToolToCategory = {
  [K in keyof typeof TOOL_CATEGORIES as (typeof TOOL_CATEGORIES)[K][number]]: K;
};

type ToolArgs<T extends AllToolsFromDefs> = CategoryArgsMap[ToolToCategory[T]];

type AnyToolArgs = CategoryArgsMap[keyof CategoryArgsMap];

export function getToolOperationArgs<T extends WhitelistCategory>(
  toolCategory: T,
  toolReq: ToolCallRequest,
  transport: Transport,
): AnyToolArgs {
  switch (toolCategory) {
    case "fileOperations":
      return { transport, abortSignal: new AbortController().signal } as FileOperationArgs;
    case "command":
      return toolReq.function.arguments as CommandArgs;
    case "mcp":
      return toolReq.function.arguments as McpArgs;
    case "fetch":
      return toolReq.function.arguments as FetchArgs;
    case "skill":
      return toolReq.function.arguments as SkillArgs;
  }
}

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

type ToolConfig<T extends AllToolsFromDefs> = {
  category: WhitelistCategory;
  getPermissionWhitelistKey: (toolName: T, args: ToolArgs<T>) => string;
  formatLabelParts: (key: string, context: LabelContext) => { text: string; bold?: boolean }[];
};

type ToolConfigs = {
  [T in AllToolsFromDefs]: ToolConfig<T>;
};

type CategoryConfigsType = {
  [K in WhitelistCategory]: {
    getPermissionWhitelistKey: (toolName: string, args: CategoryArgsMap[K]) => string;
    formatLabelParts: (key: string, context: LabelContext) => { text: string; bold?: boolean }[];
  };
};
