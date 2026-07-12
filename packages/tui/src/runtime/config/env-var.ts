import {
	configMergeAutofixEnvVar,
	configMergeEnvVar,
} from "./agentd-config.ts";
import type { Config } from "./schemas.ts";

export async function mergeEnvVar(
	config: Config,
	model: Config["models"][number],
	apiEnvVar: string,
): Promise<Config> {
	return (await configMergeEnvVar(config, model, apiEnvVar)) as Config;
}

export async function mergeAutofixEnvVar<K extends "diffApply" | "fixJson">(
	config: Config,
	key: K,
	model: Exclude<Config[K], undefined>,
	apiEnvVar: string,
): Promise<Config> {
	return (await configMergeAutofixEnvVar(
		config,
		key,
		model,
		apiEnvVar,
	)) as Config;
}
