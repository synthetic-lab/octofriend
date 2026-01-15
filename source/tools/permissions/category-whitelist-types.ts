export type FormatLabelContext = {
  permissionContext: string;
  toolName?: string;
};

export type ContextProvider = {
  cwd: (signal: AbortSignal) => Promise<string>;
};

export type CategoryConfig<TWhitelist, TArgs> = {
  getPermissionWhitelistKey: (toolName: string, args: TArgs) => string;
  formatLabelParts: (
    whitelistKey: string,
    context: FormatLabelContext,
  ) => { text: string; bold?: boolean }[];
  addToWhitelist: (whitelist: TWhitelist, whitelistKey: string) => Promise<TWhitelist>;
  isWhitelisted: (whitelist: TWhitelist, whitelistKey: string) => Promise<boolean>;
  getContext?: (provider: ContextProvider, signal: AbortSignal) => Promise<FormatLabelContext>;
};

export type CategoryWhitelistFunctions<TWhitelist = Set<string>> = {
  addToWhitelist: (whitelist: TWhitelist, whitelistKey: string) => Promise<TWhitelist>;
  isWhitelisted: (whitelist: TWhitelist, whitelistKey: string) => Promise<boolean>;
};
