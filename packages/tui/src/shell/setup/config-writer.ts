import { mergeDefaultApiKeyOverrides } from "../../runtime/config/api-keys.ts";
import { writeConfig } from "../../runtime/config/config-file.ts";
import type { Config } from "../../runtime/config/schemas.ts";
import type { AutofixConfig } from "./types.ts";

export type WriteFirstTimeConfigInput = {
	configPath: string;
	yourName: string;
	models: Config["models"];
	defaultApiKeyOverrides: Record<string, string>;
	autofixConfig?: AutofixConfig;
};

export function buildFirstTimeConfig(
	input: Omit<WriteFirstTimeConfigInput, "configPath">,
): Config {
	const config: Config = {
		yourName: input.yourName,
		models: input.models,
	};
	const { defaultApiKeyOverrides, autofixConfig } = input;
	const normalizedOverrides = mergeDefaultApiKeyOverrides(
		undefined,
		defaultApiKeyOverrides,
	);
	if (normalizedOverrides) {
		config.defaultApiKeyOverrides = normalizedOverrides;
	}
	if (autofixConfig) {
		config.diffApply = autofixConfig.diffApply;
		config.fixJson = autofixConfig.fixJson;
	}
	return config;
}

export async function writeFirstTimeConfig(
	input: WriteFirstTimeConfigInput,
): Promise<void> {
	const config = buildFirstTimeConfig(input);
	await writeConfig(config, input.configPath);
}
