export { default as edit } from "./edit.ts";
export { default as create } from "./create.ts";
export { default as append } from "./append.ts";
export { default as prepend } from "./prepend.ts";
export { default as rewrite } from "./rewrite.ts";
export { default as read } from "./read.ts";
export { default as list } from "./list.ts";

import { minimatch } from "minimatch";
import {
  CategoryConfig,
  ContextProvider,
  FormatLabelContext,
} from "../../permissions/category-whitelist-types.ts";

export type FileOperationsWhitelist = Set<string>;

export type FileOperationArgs = { filePath?: string; dirPath?: string };

export async function addToWhitelist(
  whitelist: FileOperationsWhitelist,
  whitelistKey: string,
): Promise<FileOperationsWhitelist> {
  const trimmed = whitelistKey.trim();
  if (!trimmed) return whitelist;
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(trimmed);
  return newWhitelist;
}

export async function isWhitelisted(
  whitelist: FileOperationsWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  const trimmed = whitelistKey.trim();
  for (const pattern of whitelist) {
    if (minimatch(trimmed, pattern)) {
      return true;
    }
  }
  return false;
}

export const config: CategoryConfig<FileOperationsWhitelist, FileOperationArgs> = {
  getPermissionWhitelistKey: toolName => `${toolName}:*`,
  formatLabelParts: (whitelistKey: string, context: FormatLabelContext) => {
    const getOperationText = (name: string) => {
      switch (name) {
        case "read":
          return "file reads";
        case "edit":
          return "file edits";
        case "create":
          return "file creation";
        case "append":
          return "appending to files";
        case "prepend":
          return "prepending to files";
        case "rewrite":
          return "file rewrites";
        case "list":
          return "listing files";
        default:
          return "performing file operations";
      }
    };

    const toolName = whitelistKey.split(":", 1)[0];
    const operation = getOperationText(toolName);

    return [{ text: `${operation} in ` }, { text: context.permissionContext, bold: true }];
  },
  getContext: async (provider: ContextProvider, signal: AbortSignal) => ({
    permissionContext: await provider.cwd(signal),
  }),
  addToWhitelist,
  isWhitelisted,
};
