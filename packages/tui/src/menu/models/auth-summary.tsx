import { Box, Text } from "ink";
import type React from "react";
import { useMemo } from "react";
import { normalizeRenderedLineBreaks } from "../../render/lines.ts";
import type { Config } from "../../runtime/config/schemas.ts";
import {
	type ProviderConfig,
	type ProviderKey,
	providerBaseUrlEnvVar,
	providerEntries,
	resolveProviderBaseUrl,
} from "../../runtime/models/catalog/main.ts";
import {
	authChoicesForProvider,
	CHATGPT_OAUTH_ENV_VAR,
	detectedChatGptOAuthEnvVar,
} from "./auth.ts";
import { nonEmptyEnvValue, resolveProviderEnvVar } from "./providers.ts";

type ProviderEntry = readonly [ProviderKey, ProviderConfig];

function envVarStatus(
	envVar: string,
	env: Record<string, string | undefined>,
): string {
	return nonEmptyEnvValue(envVar, env) === null ? "missing" : "detected";
}

function providerAuthSummaryText(
	provider: ProviderConfig,
	env: Record<string, string | undefined>,
	config: Pick<Config, "defaultApiKeyOverrides"> | null,
): string {
	const { supportsApiKey, supportsChatGptOAuth } =
		authChoicesForProvider(provider);
	if (supportsChatGptOAuth && supportsApiKey) {
		const apiKeyEnvVar = resolveProviderEnvVar(provider, config, null);
		return `ChatGPT OAuth via ${CHATGPT_OAUTH_ENV_VAR} (${chatGptOAuthEnvStatus(env)}); API key via ${apiKeyEnvVar} (${envVarStatus(apiKeyEnvVar, env)})`;
	}
	if (supportsChatGptOAuth) {
		return `ChatGPT OAuth via ${CHATGPT_OAUTH_ENV_VAR} (${chatGptOAuthEnvStatus(env)})`;
	}
	if (supportsApiKey) {
		const apiKeyEnvVar = resolveProviderEnvVar(provider, config, null);
		return `API key via ${apiKeyEnvVar} (${envVarStatus(apiKeyEnvVar, env)})`;
	}
	return "no supported authentication methods";
}

function chatGptOAuthEnvStatus(
	env: Record<string, string | undefined>,
): string {
	const detectedEnvVar = detectedChatGptOAuthEnvVar(env);
	if (detectedEnvVar === null) return "missing";
	if (detectedEnvVar === CHATGPT_OAUTH_ENV_VAR) return "detected";
	return `detected via ${detectedEnvVar}`;
}

function providerSetupSummaryLine(
	providerKey: ProviderKey,
	provider: ProviderConfig,
	env: Record<string, string | undefined>,
	config: Pick<Config, "defaultApiKeyOverrides"> | null,
): string {
	const baseUrlEnvVar = providerBaseUrlEnvVar(providerKey);
	const authText = providerAuthSummaryText(provider, env, config);
	const activeBaseUrl = resolveProviderBaseUrl(providerKey, provider, env);
	const activeBaseUrlText =
		activeBaseUrl === provider.baseUrl
			? ""
			: `; active base URL ${activeBaseUrl}`;
	const baseUrlText = baseUrlEnvVar
		? `; ${baseUrlEnvVar} can override ${provider.baseUrl}${activeBaseUrlText}`
		: activeBaseUrlText;
	return `${provider.name}: ${authText}${baseUrlText}`;
}

export function providerSetupSummaryLines(
	entries: readonly ProviderEntry[] = providerEntries(),
	env: Record<string, string | undefined> = process.env,
	config: Pick<Config, "defaultApiKeyOverrides"> | null = null,
): string[] {
	const lines = new Array<string>(entries.length);
	let writeIndex = 0;
	for (const entry of entries) {
		if (entry === undefined) continue;
		const providerKey = entry[0];
		const provider = entry[1];
		lines[writeIndex] = providerSetupSummaryLine(
			providerKey,
			provider,
			env,
			config,
		);
		writeIndex += 1;
	}
	if (writeIndex < lines.length) lines.length = writeIndex;
	return lines;
}

function buildProviderSetupSummaryItems(
	entries: readonly ProviderEntry[] = providerEntries(),
	env: Record<string, string | undefined> = process.env,
	config: Pick<Config, "defaultApiKeyOverrides"> | null = null,
): React.ReactNode[] {
	const items = new Array<React.ReactNode>(entries.length);
	let writeIndex = 0;
	for (const entry of entries) {
		if (entry === undefined) continue;
		const providerKey = entry[0];
		const provider = entry[1];
		const line = providerSetupSummaryLine(providerKey, provider, env, config);
		items[writeIndex] = (
			<Text key={providerKey} color="gray">
				{normalizeRenderedLineBreaks(line)}
			</Text>
		);
		writeIndex += 1;
	}
	if (writeIndex < items.length) items.length = writeIndex;
	return items;
}

export function ProviderSetupSummary({
	config = null,
	env = process.env,
}: {
	config?: Pick<Config, "defaultApiKeyOverrides"> | null;
	env?: Record<string, string | undefined>;
}) {
	const summaryItems = useMemo(
		() => buildProviderSetupSummaryItems(providerEntries(), env, config),
		[config, env],
	);
	return (
		<Box flexDirection="column">
			<Text color="gray">Provider setup at a glance:</Text>
			{summaryItems}
		</Box>
	);
}
