import * as fileOperations from "./file-operations/index.ts";
import * as command from "./command/index.ts";
import * as mcp from "./mcp/index.ts";
import * as fetch from "./fetch/index.ts";
import * as skill from "./skill/index.ts";

import type { FileOperationArgs } from "./file-operations/index.ts";
import type { CommandArgs } from "./command/index.ts";
import type { McpArgs } from "./mcp/index.ts";
import type { FetchArgs } from "./fetch/index.ts";
import type { SkillArgs } from "./skill/index.ts";
import { WhitelistCategory } from "../permissions/merged-whitelist.ts";

const keysOf = <T extends Record<string, unknown>>(obj: T) => Object.keys(obj) as Array<keyof T>;

export const TOOL_CATEGORIES = {
  fileOperations: keysOf(fileOperations) as string[],
  command: keysOf(command) as string[],
  mcp: keysOf(mcp) as string[],
  fetch: keysOf(fetch) as string[],
  skill: keysOf(skill) as string[],
} as const;

export function getToolCategory(toolName: string): WhitelistCategory | null {
  for (const [category, tools] of Object.entries(TOOL_CATEGORIES)) {
    if (tools.includes(toolName)) {
      return category as WhitelistCategory;
    }
  }
  return null;
}

export type CategoryArgsMap = {
  fileOperations: FileOperationArgs;
  command: CommandArgs;
  mcp: McpArgs;
  fetch: FetchArgs;
  skill: SkillArgs;
};
