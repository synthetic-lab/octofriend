import type { Auth, Config } from "../../runtime/config/schemas";
import {
	type ProviderConfig,
	providerBaseUrlsMatch,
	providerForModelConfig,
} from "../../runtime/models/catalog/main";
import { isApiKeyEnvAuth } from "../../menu/models/auth";

type ModelEndpointIdentity = Pick<Config["models"][number], "baseUrl" | "type">;

export function resolveModelFromConfig(
	config: Config,
	model: Config["models"][number],
): Config["models"][number] {
	let fallback: Config["models"][number] | undefined;
	let index = 0;
	while (index < config.models.length) {
		const candidate = config.models[index];
		if (candidate && modelsShareEndpoint(candidate, model)) {
			if (candidate.nickname === model.nickname) return candidate;
			fallback ??= candidate;
		}
		index += 1;
	}
	return fallback ?? model;
}

export function providerForPreflightModel(
	model: Pick<Config["models"][number], "baseUrl" | "type">,
): ProviderConfig | null {
	return providerForModelConfig(model);
}

export function shouldMergeEnvAuthAsDefaultApiKey(
	auth: Auth,
): auth is Extract<Auth, { type: "env" }> {
	return isApiKeyEnvAuth(auth);
}

export function indexOfModel(
	models: Config["models"],
	model: Config["models"][number],
): number {
	let fallbackIndex = -1;
	let index = 0;
	while (index < models.length) {
		const candidate = models[index];
		if (candidate === model) return index;
		if (candidate && modelsShareEndpoint(candidate, model)) {
			if (candidate.nickname === model.nickname) return index;
			if (fallbackIndex === -1) fallbackIndex = index;
		}
		index += 1;
	}
	return fallbackIndex;
}

export function replaceModelAtIndex(
	models: Config["models"],
	indexToReplace: number,
	model: Config["models"][number],
): Config["models"] {
	const updated = new Array<Config["models"][number]>(models.length);
	let index = 0;
	let writeIndex = 0;
	while (index < models.length) {
		const nextModel = index === indexToReplace ? model : models[index];
		if (nextModel !== undefined) {
			updated[writeIndex] = nextModel;
			writeIndex += 1;
		}
		index += 1;
	}
	if (writeIndex < updated.length) updated.length = writeIndex;
	return updated;
}

export function applyModelAuthToConfig(
	config: Config,
	model: Config["models"][number],
	auth: Auth,
): { config: Config; model: Config["models"][number] } | null {
	const resolvedModel = resolveModelFromConfig(config, model);
	const index = indexOfModel(config.models, resolvedModel);
	if (index < 0) return null;
	const { apiEnvVar: _apiEnvVar, ...modelWithoutLegacyAuth } = resolvedModel;
	const updatedModel = { ...modelWithoutLegacyAuth, auth };
	return {
		config: {
			...config,
			models: replaceModelAtIndex(config.models, index, updatedModel),
		},
		model: updatedModel,
	};
}

function modelsShareEndpoint(
	left: ModelEndpointIdentity,
	right: ModelEndpointIdentity,
): boolean {
	if (!providerBaseUrlsMatch(left.baseUrl, right.baseUrl)) return false;
	if (left.type && right.type && left.type !== right.type) return false;
	return true;
}

export function resolveAutofixModelFromConfig<
	K extends "diffApply" | "fixJson",
>(
	config: Config,
	model: Exclude<Config[K], undefined>,
	key: K,
): Exclude<Config[K], undefined> {
	const candidate = config[key];
	if (candidate && providerBaseUrlsMatch(candidate.baseUrl, model.baseUrl)) {
		return candidate as Exclude<Config[K], undefined>;
	}
	return (candidate ?? model) as Exclude<Config[K], undefined>;
}

export function applyAutofixAuthToConfig<K extends "diffApply" | "fixJson">(
	config: Config,
	model: Exclude<Config[K], undefined>,
	key: K,
	auth: Auth,
): { config: Config; model: Exclude<Config[K], undefined> } {
	const resolvedModel = resolveAutofixModelFromConfig(config, model, key);
	const { apiEnvVar: _apiEnvVar, ...modelWithoutLegacyAuth } = resolvedModel;
	const updatedModel = { ...modelWithoutLegacyAuth, auth } as Exclude<
		Config[K],
		undefined
	>;
	return {
		config: { ...config, [key]: updatedModel },
		model: updatedModel,
	};
}
