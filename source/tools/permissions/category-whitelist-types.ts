import { CommandArgs } from "../tool-defs/command/index.ts";
import { FetchArgs } from "../tool-defs/fetch/index.ts";
import { FileOperationArgs } from "../tool-defs/file-operations/index.ts";
import { McpArgs } from "../tool-defs/mcp/index.ts";
import { SkillArgs } from "../tool-defs/skill/index.ts";
import { WebSearchArgs } from "../tool-defs/web-search/index.ts";
import { WhitelistCategoryData } from "./merged-whitelist.ts";

export type LabelContext = {
  permissionContext: string;
  toolName?: string;
};

type ToolOperationArgs =
  | FileOperationArgs
  | McpArgs
  | CommandArgs
  | FetchArgs
  | SkillArgs
  | WebSearchArgs;

export type CategoryConfig<
  TWhitelist extends WhitelistCategoryData,
  TArgs extends ToolOperationArgs,
> = {
  getPermissionWhitelistKey: (toolName: string, args: TArgs) => Promise<string>;
  getPermissionContext?: (args: TArgs) => Promise<string>;
  yesAndAlwaysAllowLabelSuffix: (
    whitelistKey: string,
    context: LabelContext,
  ) => { text: string; bold?: boolean }[];
  addToWhitelist: (whitelist: TWhitelist, whitelistKey: string) => Promise<TWhitelist>;
  isWhitelisted: (whitelist: TWhitelist, whitelistKey: string) => Promise<boolean>;
};

export type CategoryWhitelistFunctions<TWhitelist = Set<string>> = {
  addToWhitelist: (whitelist: TWhitelist, whitelistKey: string) => Promise<TWhitelist>;
  isWhitelisted: (whitelist: TWhitelist, whitelistKey: string) => Promise<boolean>;
};
