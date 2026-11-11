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
