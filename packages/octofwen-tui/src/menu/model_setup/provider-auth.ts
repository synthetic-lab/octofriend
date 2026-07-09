import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type {
	ProviderAuthMethod,
	ProviderConfig,
} from "../../internal/model-provider-catalog/main.ts";
import { keyFromName } from "../../internal/model-provider-catalog/main.ts";
import {
	nonEmptyEnvValue,
	nonEmptyTrimmedValue,
	resolveProviderEnvVar,
} from "./provider-helpers.ts";

export type AuthChoiceSupport = {
	readonly supportsApiKey: boolean;
	readonly supportsChatGptOAuth: boolean;
};

const DEFAULT_AUTH_METHODS = ["api-key"] as const;

export function supportsAuthMethod(
	authMethods: readonly ProviderAuthMethod[] | undefined,
	method: ProviderAuthMethod,
): boolean {
	if (authMethods === undefined) return method === "api-key";
	const count = authMethods.length;
	if (count === 0) return false;
	if (count === 1) return authMethods[0] === method;
	let index = 0;
	while (index < count) {
		if (authMethods[index] === method) return true;
		index += 1;
	}
	return false;
}

export function authChoicesForProvider(
	provider: Pick<ProviderConfig, "authMethods"> | null | undefined,
): AuthChoiceSupport {
	if (provider == null) {
		return { supportsApiKey: false, supportsChatGptOAuth: false };
	}
	return {
		supportsApiKey: supportsAuthMethod(provider.authMethods, "api-key"),
		supportsChatGptOAuth: supportsAuthMethod(
			provider.authMethods,
			"chatgpt-oauth",
		),
	};
}

export function providerAuthText(
	provider: Pick<ProviderConfig, "authMethods">,
): string {
	const { supportsApiKey, supportsChatGptOAuth } =
		authChoicesForProvider(provider);
	if (supportsChatGptOAuth && supportsApiKey) {
		return "ChatGPT OAuth or API key";
	}
	if (supportsChatGptOAuth) return "ChatGPT OAuth";
	if (supportsApiKey) return "API key";
	return "no supported authentication methods";
}

export function providerAuthShortcutText(
	provider: Pick<ProviderConfig, "authMethods" | "envVar">,
	apiKeyEnvVar = provider.envVar,
): string {
	const { supportsApiKey, supportsChatGptOAuth } =
		authChoicesForProvider(provider);
	if (supportsChatGptOAuth && supportsApiKey) {
		return `ChatGPT OAuth or ${apiKeyEnvVar}`;
	}
	if (supportsChatGptOAuth) return "ChatGPT OAuth";
	if (supportsApiKey) return apiKeyEnvVar;
	return "no supported authentication methods";
}

export function isApiKeyEnvAuth(
	auth: Auth,
): auth is Extract<Auth, { type: "env" }> {
	return (
		auth.type === "env" &&
		(auth.credential === undefined || auth.credential === "api-key")
	);
}

export function shouldPersistDefaultApiKeyOverride(
	auth: Auth,
): auth is Extract<Auth, { type: "env" }> {
	return isApiKeyEnvAuth(auth);
}

export function apiKeyEnvAuth(name: string): Auth {
	return { type: "env", name, credential: "api-key" };
}

export function chatGptOAuthEnvAuth(name: string): Auth {
	return { type: "env", name, credential: "chatgpt-oauth" };
}

export function defaultApiKeyOverrideForProviderAuth(
	provider: Pick<ProviderConfig, "name">,
	auth: Auth | undefined,
): Record<string, string> | null {
	if (!(auth && shouldPersistDefaultApiKeyOverride(auth))) return null;
	const envVarName = nonEmptyTrimmedValue(auth.name);
	if (envVarName === null) return null;
	const key = keyFromName(provider.name);
	if (!key.success) return null;
	return { [key.data]: envVarName };
}

export const CHATGPT_OAUTH_ENV_VAR = "CODEX_ACCESS_TOKEN";
export const LEGACY_CHATGPT_OAUTH_ENV_VAR = "OPENAI_CODEX_ACCESS_TOKEN";
export const CHATGPT_OAUTH_ENV_VARS = [
	CHATGPT_OAUTH_ENV_VAR,
	LEGACY_CHATGPT_OAUTH_ENV_VAR,
] as const;

export type DetectedProviderAuth = {
	readonly overrideAuth: Auth | null;
	readonly useEnvVar: boolean;
};

export function detectedChatGptOAuthEnvVar(
	env: Record<string, string | undefined> = process.env,
): string | null {
	for (let index = 0; index < CHATGPT_OAUTH_ENV_VARS.length; index += 1) {
		const envVar = CHATGPT_OAUTH_ENV_VARS[index];
		if (envVar !== undefined && nonEmptyEnvValue(envVar, env) !== null) {
			return envVar;
		}
	}
	return null;
}

export function detectExistingProviderAuth(
	provider: ProviderConfig,
	config: Config | null,
	env: Record<string, string | undefined> = process.env,
): DetectedProviderAuth | null {
	const envVar = resolveProviderEnvVar(provider, config, null);
	const authMethods = provider.authMethods ?? DEFAULT_AUTH_METHODS;
	let index = 0;
	while (index < authMethods.length) {
		const method = authMethods[index];
		index += 1;
		if (method === "api-key" && nonEmptyEnvValue(envVar, env) !== null) {
			return { overrideAuth: null, useEnvVar: true };
		}
		if (method === "chatgpt-oauth") {
			const oauthEnvVar = detectedChatGptOAuthEnvVar(env);
			if (oauthEnvVar !== null) {
				return {
					overrideAuth: chatGptOAuthEnvAuth(oauthEnvVar),
					useEnvVar: false,
				};
			}
		}
	}
	return null;
}
