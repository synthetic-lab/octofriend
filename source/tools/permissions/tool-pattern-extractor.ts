import { ToolCallRequest } from "../../ir/llm-ir.ts";
import { WhitelistType } from "./index.ts";
import {
  extractCommandPrefix,
  extractMcpToolPattern,
} from "./whitelist.ts";
import { cwd } from "process";
import { TOOL_CATEGORIES } from "../tool-defs/categories.ts";

export interface ToolPermissionInfo {
  type: WhitelistType;
  value: string;
  pattern: string;
  label: string;
  labelParts: { text: string; bold?: boolean }[];
}

interface ToolConfig {
  type: WhitelistType;
  extractValue: (args: Record<string, unknown>) => string;
  extractPattern: (value: string) => string;
  formatLabelParts: (pattern: string) => { text: string; bold?: boolean }[];
}

const CATEGORY_CONFIGS: Record<WhitelistType, Omit<ToolConfig, 'type'>> = {
  fileOperations: {
    extractValue: (args: Record<string, unknown>) =>
      (args['filePath'] || args['dirPath'] || '') as string,
    extractPattern: () => "*",
    formatLabelParts: () => [
      { text: 'file operations in ' },
      { text: cwd(), bold: true },
    ],
  },
  command: {
    extractValue: (args: Record<string, unknown>) => args['cmd'] as string,
    extractPattern: extractCommandPrefix,
    formatLabelParts: (pattern: string) => [
      { text: 'commands starting with ' },
      { text: pattern, bold: true },
    ],
  },
  mcp: {
    extractValue: (args: Record<string, unknown>) => args['tool'] as string,
    extractPattern: extractMcpToolPattern,
    formatLabelParts: (pattern: string) => [
      { text: 'MCP tools matching ' },
      { text: pattern, bold: true },
    ],
  },
  fetch: {
    extractValue: (args: Record<string, unknown>) => args['url'] as string,
    extractPattern: () => "*",
    formatLabelParts: () => [{ text: 'fetch operation' }],
  },
  skill: {
    extractValue: (args: Record<string, unknown>) => args['skillName'] as string,
    extractPattern: () => "*",
    formatLabelParts: () => [{ text: 'skill execution' }],
  },
};

type AllToolsFromDefs = typeof TOOL_CATEGORIES[keyof typeof TOOL_CATEGORIES][number];

type ToolConfigs = Record<string, ToolConfig> & {
  [K in AllToolsFromDefs]: ToolConfig;
};

const TOOL_CONFIGS: ToolConfigs = Object.fromEntries(
  (Object.entries(TOOL_CATEGORIES) as Array<[WhitelistType, readonly string[]]>).flatMap(
    ([type, tools]) =>
      tools.map(tool => [
        tool,
        {
          type,
          ...CATEGORY_CONFIGS[type],
        } as ToolConfig
      ])
  )
) as ToolConfigs;

export function extractToolPermissionInfo(toolReq: ToolCallRequest): ToolPermissionInfo {
  const toolName = toolReq.function.name as AllToolsFromDefs;
  const config = TOOL_CONFIGS[toolName];
  const args = toolReq.function.arguments || {};
  const value = config.extractValue(args);
  const pattern = config.extractPattern(value);

  return {
    type: config.type,
    value,
    pattern,
    label: config.formatLabelParts(pattern).map(part => part.text).join(''),
    labelParts: config.formatLabelParts(pattern),
  };
}

