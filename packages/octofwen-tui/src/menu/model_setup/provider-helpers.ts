import { nonEmptyTrimmedText } from "../../app/text_processing.ts";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	keyFromName,
	type ProviderConfig,
	providerForBaseUrl,
} from "../../internal/model-provider-catalog/main.ts";

export function getProviderDisplayName(baseUrl: string): string {
	const provider = providerForBaseUrl(baseUrl);
	return provider?.name || baseUrl;
}

export function getProviderApiKeyUrl(baseUrl: string): string | null {
	const provider = providerForBaseUrl(baseUrl);
	return provider?.apiKeyUrl ?? null;
}

export function terminalHyperlink(url: string, label = url): string {
	return `\u001B]8;;${url}\u0007${label}\u001B]8;;\u0007`;
}

export function nonEmptyEnvValue(
	name: string,
	env: Record<string, string | undefined> = process.env,
): string | null {
	const value = env[name];
	if (value === undefined) return null;
	return nonEmptyTrimmedText(value);
}

export { nonEmptyTrimmedText as nonEmptyTrimmedValue };

export function resolveProviderEnvVar(
	provider: ProviderConfig,
	config: Pick<Config, "defaultApiKeyOverrides"> | null,
	overrideEnvVar: string | null,
): string {
	const trimmedOverride =
		overrideEnvVar === null ? null : nonEmptyTrimmedText(overrideEnvVar);
	if (trimmedOverride !== null) return trimmedOverride;
	const key = keyFromName(provider.name);
	const configured = key.success
		? config?.defaultApiKeyOverrides?.[key.data]
		: undefined;
	if (configured !== undefined) {
		const trimmedConfigured = nonEmptyTrimmedText(configured);
		if (trimmedConfigured === null) return provider.envVar;
		return trimmedConfigured;
	}
	return provider.envVar;
}
