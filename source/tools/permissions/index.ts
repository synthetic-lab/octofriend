import { SKIP_CONFIRMATION_TOOLS } from "../index.ts";

export type PermissionsData = {
  command: Set<string>,
  filePattern: Set<string>,
  mcpTool: Set<string>,
  fetch: Set<string>,
  skill: Set<string>,
};

export type WhitelistType = keyof PermissionsData;

export function shouldSkipConfirmation(
  toolName: string,
  unchained: boolean,
  isWhitelisted: boolean
): boolean {
  return unchained || SKIP_CONFIRMATION_TOOLS.includes(toolName) || isWhitelisted;
}

export { extractToolPermissionInfo, type ToolPermissionInfo } from './tool-pattern-extractor.ts';
