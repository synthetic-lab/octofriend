import type { Config } from "./schemas.ts";

export function withServerDisabled(serverName: string, config: Config): Config {
	const existing = config.lsp === false ? {} : (config.lsp ?? {});
	return { ...config, lsp: { ...existing, [serverName]: { disabled: true } } };
}

export function withAllServersDisabled(config: Config): Config {
	return { ...config, lsp: false };
}
