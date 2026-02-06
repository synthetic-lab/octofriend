export { default as edit } from "./edit.ts";
export { default as create } from "./create.ts";
export { default as append } from "./append.ts";
export { default as prepend } from "./prepend.ts";
export { default as rewrite } from "./rewrite.ts";
export { default as read } from "./read.ts";
export { default as list } from "./list.ts";

import { Transport } from "../../../transports/transport-common.ts";
import { CategoryConfig } from "../../permissions/category-whitelist-types.ts";

export type FileOperationsWhitelist = Set<string>;

export type FileOperationArgs = {
  transport: Transport;
  abortSignal: AbortSignal;
};

export async function addToWhitelist(
  whitelist: FileOperationsWhitelist,
  whitelistKey: string,
): Promise<FileOperationsWhitelist> {
  const newWhitelist = new Set(whitelist);
  newWhitelist.add(whitelistKey);
  return newWhitelist;
}

export async function isWhitelisted(
  whitelist: FileOperationsWhitelist,
  whitelistKey: string,
): Promise<boolean> {
  return whitelist.has(whitelistKey);
}

export const config: CategoryConfig<FileOperationsWhitelist, FileOperationArgs> = {
  getPermissionWhitelistKey: async (toolName, { transport, abortSignal }) => {
    const cwd = await transport.cwd(abortSignal);
    return `${toolName}:${cwd}`;
  },
  getPermissionContext: async ({ transport, abortSignal }) => {
    return await transport.cwd(abortSignal);
  },
  addToWhitelist,
  isWhitelisted,
};
