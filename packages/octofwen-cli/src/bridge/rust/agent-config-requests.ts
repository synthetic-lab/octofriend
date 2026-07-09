import * as agentMethods from "./agent-methods.ts";
import {
	type AgentdRequestClient,
	requestAgentdResult,
	unwrapAgentdResult,
	validateAgentdResult,
} from "./agent-validation.ts";
import {
	type AgentdConfigAutofixKeysResult,
	type AgentdConfigHasExistingKeyResult,
	type AgentdConfigKeyForBaseUrlParams,
	type AgentdConfigKeyForModelParams,
	type AgentdConfigKeyResultEnvelope,
	type AgentdConfigParams,
	type AgentdConfigResult,
	type AgentdConfigSearchParams,
	type AgentdConfigSearchResult,
	type AgentdConfigWriteKeyParams,
	type AgentdConfigWriteKeyResult,
	isAgentdConfigAutofixKeysResult,
	isAgentdConfigHasExistingKeyResult,
	isAgentdConfigKeyResultEnvelope,
	isAgentdConfigResult,
	isAgentdConfigSearchResult,
	isAgentdConfigWriteKeyResult,
} from "./config.ts";
import {
	invalidAgentdConfigAutofixKeysResponseError,
	invalidAgentdConfigResponseError,
} from "./errors.ts";

export async function configMigrate(
	client: AgentdRequestClient,
	params: AgentdConfigParams,
): Promise<AgentdConfigResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_MIGRATE_METHOD,
		params,
		isAgentdConfigResult,
		invalidAgentdConfigResponseError,
	);
}

export async function configSanitize(
	client: AgentdRequestClient,
	params: AgentdConfigParams,
): Promise<AgentdConfigResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_SANITIZE_METHOD,
		params,
		isAgentdConfigResult,
		invalidAgentdConfigResponseError,
	);
}

export async function configAutofixKeys(
	client: AgentdRequestClient,
): Promise<AgentdConfigAutofixKeysResult> {
	const result = await client.request(
		agentMethods.AGENTD_CONFIG_AUTOFIX_KEYS_METHOD,
	);
	return unwrapAgentdResult(
		validateAgentdResult(
			result,
			isAgentdConfigAutofixKeysResult,
			invalidAgentdConfigAutofixKeysResponseError,
		),
	);
}

export async function configKeyForModel(
	client: AgentdRequestClient,
	params: AgentdConfigKeyForModelParams,
): Promise<AgentdConfigKeyResultEnvelope> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
		params,
		isAgentdConfigKeyResultEnvelope,
		invalidAgentdConfigResponseError,
	);
}

export async function configKeyForBaseUrl(
	client: AgentdRequestClient,
	params: AgentdConfigKeyForBaseUrlParams,
): Promise<AgentdConfigKeyResultEnvelope> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_KEY_FOR_BASE_URL_METHOD,
		params,
		isAgentdConfigKeyResultEnvelope,
		invalidAgentdConfigResponseError,
	);
}

export async function configSearch(
	client: AgentdRequestClient,
	params: AgentdConfigSearchParams,
): Promise<AgentdConfigSearchResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_SEARCH_METHOD,
		params,
		isAgentdConfigSearchResult,
		invalidAgentdConfigResponseError,
	);
}

export async function configHasExistingKey(
	client: AgentdRequestClient,
	params: AgentdConfigKeyForBaseUrlParams,
): Promise<AgentdConfigHasExistingKeyResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_HAS_EXISTING_KEY_METHOD,
		params,
		isAgentdConfigHasExistingKeyResult,
		invalidAgentdConfigResponseError,
	);
}

export async function configWriteKey(
	client: AgentdRequestClient,
	params: AgentdConfigWriteKeyParams,
): Promise<AgentdConfigWriteKeyResult> {
	return await requestAgentdResult(
		client,
		agentMethods.AGENTD_CONFIG_WRITE_KEY_METHOD,
		params,
		isAgentdConfigWriteKeyResult,
		invalidAgentdConfigResponseError,
	);
}
