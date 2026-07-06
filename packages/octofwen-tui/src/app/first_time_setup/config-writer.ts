import { writeConfig } from "../../internal/configuration/config-file.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import type { AutofixConfig } from "./types.ts";

export type WriteFirstTimeConfigInput = {
	configPath: string;
	yourName: string;
	models: Config["models"];
	defaultApiKeyOverrides: Record<string, string>;
	autofixConfig?: AutofixConfig;
};

export async function writeFirstTimeConfig({
	configPath,
	yourName,
	models,
	defaultApiKeyOverrides,
	autofixConfig,
}: WriteFirstTimeConfigInput): Promise<void> {
	const config: Config = {
		yourName,
		models,
	};
	if (defaultApiKeyOverrides) {
		config.defaultApiKeyOverrides = defaultApiKeyOverrides;
	}
	if (autofixConfig) {
		config.diffApply = autofixConfig.diffApply;
		config.fixJson = autofixConfig.fixJson;
	}

	await writeConfig(config, configPath);
}
