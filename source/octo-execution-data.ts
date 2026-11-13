import { readSearchConfig, type Config } from "./config.ts";
import type { LspToolData } from "./libocto/lsp/detect.ts";
import type { McpToolData } from "./libocto/toolkits/mcp/index.ts";
import type { SkillToolData } from "./libocto/toolkits/skill/index.ts";
import type { ResolvedSearchConfig, WebSearchData } from "./libocto/toolkits/web-search/index.ts";

export type OctoExecutionData = Omit<Config, "lsp" | "skills"> &
  WebSearchData &
  SkillToolData &
  McpToolData &
  LspToolData;

type SearchConfigReader = (config: Config) => Promise<ResolvedSearchConfig | null>;

export function createCachedSearchConfigReader(reader: SearchConfigReader): SearchConfigReader {
  let successful: ResolvedSearchConfig | null = null;
  let inFlight: Promise<ResolvedSearchConfig | null> | null = null;

  return async config => {
    if (successful != null) return successful;
    if (inFlight != null) return inFlight;

    const pending = Promise.resolve().then(() => reader(config));
    inFlight = pending;
    try {
      const resolved = await pending;
      if (resolved != null) successful = resolved;
      return resolved;
    } finally {
      if (inFlight === pending) inFlight = null;
    }
  };
}

const readCachedSearchConfig = createCachedSearchConfigReader(readSearchConfig);

export function adaptOctoExecutionData(
  config: Config,
  searchConfig: ResolvedSearchConfig | null,
): OctoExecutionData {
  const { lsp: _, ...configWithoutLsp } = config;
  return {
    ...configWithoutLsp,
    searchConfig,
    skillPaths: config.skills?.paths,
    lsp: config.lsp === false ? { disabled: true, config: {} } : { config: config.lsp ?? {} },
  };
}

export async function getOctoExecutionData(config: Config): Promise<OctoExecutionData> {
  return adaptOctoExecutionData(config, await readCachedSearchConfig(config));
}
