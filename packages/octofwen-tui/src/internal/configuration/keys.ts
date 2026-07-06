import {
	configHasExistingKey,
	configKeyForBaseUrl,
	configKeyForModel,
	configSearch,
	configWriteKey,
} from "./agentd-config.ts";
import type { Auth, Config, KeyResult } from "./schemas.ts";

export async function readSearchConfig(config: Config | null) {
	return await configSearch(config);
}

export async function findSyntheticKey(config: Config | null) {
	const search = await readSearchConfig(config);
	return search?.key ?? null;
}

export async function assertKeyForModel(
	model: { baseUrl: string; apiEnvVar?: string; auth?: Auth },
	config: Config | null,
): Promise<string> {
	const result = await readKeyForModelWithDetails(model, config);
	if (!result.ok) throw new Error(result.error.message);
	return result.key;
}

export async function readKeyForModel(
	model: { baseUrl: string; apiEnvVar?: string; auth?: Auth },
	config: Config | null,
): Promise<string | null> {
	const result = await readKeyForModelWithDetails(model, config);
	return result.ok ? result.key : null;
}

export async function readKeyForModelWithDetails(
	model: { baseUrl: string; apiEnvVar?: string; auth?: Auth },
	config: Config | null,
): Promise<KeyResult> {
	return (await configKeyForModel(model, config)) as KeyResult;
}

export async function readKeyForBaseUrl(
	baseUrl: string,
	config: Config | null,
): Promise<string | null> {
	const result = await readKeyForBaseUrlResult(baseUrl, config);
	return result.ok ? result.key : null;
}

export async function resolveConfiguredAuthKey(model: {
	auth?: Auth;
	apiEnvVar?: string;
}): Promise<KeyResult | null> {
	const result = await readKeyForModelWithDetails(
		{ baseUrl: "", ...model },
		null,
	);
	return result.ok ? result : null;
}

export async function readConfiguredModelKey(
	baseUrl: string,
	config: Config | null,
): Promise<KeyResult | null> {
	const result = await readKeyForBaseUrlResult(baseUrl, config);
	return result.ok ? result : null;
}

export async function readKeyForBaseUrlResult(
	baseUrl: string,
	config: Config | null,
): Promise<KeyResult> {
	return (await configKeyForBaseUrl(baseUrl, config)) as KeyResult;
}

export async function hasExistingKeyForBaseUrl(
	baseUrl: string,
	config: Config | null,
): Promise<boolean> {
	return await configHasExistingKey(baseUrl, config);
}

export async function writeKeyForModel(
	model: { baseUrl: string },
	apiKey: string,
) {
	await configWriteKey(model.baseUrl, apiKey);
}
