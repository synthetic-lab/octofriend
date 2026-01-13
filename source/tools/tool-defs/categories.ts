import * as fileOperations from "./fileOperations/index.ts";
import * as command from "./command/index.ts";
import * as mcp from "./mcp/index.ts";
import * as fetch from "./fetch/index.ts";
import * as skill from "./skill/index.ts";
import * as toolMap from "./index.ts";

const keysOf = <T extends Record<string, unknown>>(obj: T) =>
  Object.keys(obj) as Array<keyof T>;

export const TOOL_CATEGORIES = {
  fileOperations: keysOf(fileOperations),
  command: keysOf(command),
  mcp: keysOf(mcp),
  fetch: keysOf(fetch),
  skill: keysOf(skill),
} as const;

type AllCategorizedTools = typeof TOOL_CATEGORIES[keyof typeof TOOL_CATEGORIES][number];
type AllExportedTools = keyof typeof toolMap;

type _CheckAllToolsCategorized = AllExportedTools extends AllCategorizedTools ? true : never;
type _CheckNoExtraCategories = AllCategorizedTools extends AllExportedTools ? true : never;
