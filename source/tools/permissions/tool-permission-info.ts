import { ToolCallRequest } from "../../ir/llm-ir.ts";
import { WhitelistType } from "./index.ts";
import { TOOL_CATEGORIES, CategoryArgsMap } from "../tool-defs/categories.ts";
import { categoryConfigs } from "./merged-whitelist.ts";
import { FormatLabelContext } from "./category-whitelist-types.ts";

export type ToolPermissionInfo = {
  type: WhitelistType;
  value: string;
  pattern: string;
  label: string;
  labelParts: { text: string; bold?: boolean }[];
};

type AllToolsFromDefs = (typeof TOOL_CATEGORIES)[keyof typeof TOOL_CATEGORIES][number];

type ToolToCategory = {
  [K in keyof typeof TOOL_CATEGORIES as (typeof TOOL_CATEGORIES)[K][number]]: K;
};

type ToolArgs<T extends AllToolsFromDefs> = CategoryArgsMap[ToolToCategory[T]];

type AnyToolArgs = CategoryArgsMap[keyof CategoryArgsMap];

type ToolConfig<T extends AllToolsFromDefs> = {
  type: WhitelistType;
  getPermissionWhitelistKey: (toolName: T, args: ToolArgs<T>) => string;
  formatLabelParts: (
    key: string,
    context: FormatLabelContext,
  ) => { text: string; bold?: boolean }[];
};

type ToolConfigs = {
  [T in AllToolsFromDefs]: ToolConfig<T>;
};

type CategoryConfigsType = {
  [K in WhitelistType]: {
    getPermissionWhitelistKey: (toolName: string, args: CategoryArgsMap[K]) => string;
    formatLabelParts: (
      key: string,
      context: FormatLabelContext,
    ) => { text: string; bold?: boolean }[];
  };
};

const CATEGORY_CONFIGS: CategoryConfigsType = categoryConfigs;

const TOOL_CONFIGS = Object.fromEntries(
  (Object.entries(TOOL_CATEGORIES) as Array<[WhitelistType, readonly string[]]>).flatMap(
    ([type, tools]) =>
      tools.map(tool => [
        tool,
        {
          type,
          ...CATEGORY_CONFIGS[type],
        },
      ]),
  ),
) as ToolConfigs;

type WidenedToolConfig = {
  type: WhitelistType;
  getPermissionWhitelistKey: (toolName: string, args: AnyToolArgs) => string;
  formatLabelParts: (
    key: string,
    context: FormatLabelContext,
  ) => { text: string; bold?: boolean }[];
};

export function extractToolPermissionInfo(
  toolReq: ToolCallRequest,
  context: FormatLabelContext,
): ToolPermissionInfo {
  const toolName = toolReq.function.name as AllToolsFromDefs;
  const config = TOOL_CONFIGS[toolName] as WidenedToolConfig;
  const args = (toolReq.function.arguments || {}) as AnyToolArgs;
  const value = config.getPermissionWhitelistKey(toolName, args);
  const labelContext = { ...context, toolName };

  return {
    type: config.type,
    value,
    pattern: value,
    label: config
      .formatLabelParts(value, labelContext)
      .map(part => part.text)
      .join(""),
    labelParts: config.formatLabelParts(value, labelContext),
  };
}
