export type ResolvedSearchConfig = {
  url: string;
  key: string;
};

export type WebSearchData = {
  searchConfig: ResolvedSearchConfig | null;
};

export type SkillToolData = {
  skillPaths?: readonly string[];
};

export type McpServerSpec = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  log?: boolean;
};

export type McpToolData = {
  mcpServers?: Record<string, McpServerSpec>;
};

export type LspToolData = {
  lsp: {
    disabled?: boolean;
    config: Record<
      string,
      | { disabled: true }
      | {
          command: string[];
          extensions: string[];
          rootCandidates: string[];
        }
    >;
  };
};
