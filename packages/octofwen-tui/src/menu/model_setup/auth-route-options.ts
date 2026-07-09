import type { ShortcutArray } from "../../input/shortcuts.tsx";
import type { FullFlowRouteData } from "./add-model-types.ts";
import {
	CHATGPT_OAUTH_ENV_VAR,
	LEGACY_CHATGPT_OAUTH_ENV_VAR,
	providerAuthText,
} from "./provider-auth.ts";

export type AuthChoiceRoute = "apiKey" | "chatGptOAuth" | "envVar" | "command";

type AuthProvider = FullFlowRouteData["authAsk"]["provider"];

type RequiredAuthProvider = NonNullable<AuthProvider>;

function authProviderName(provider: AuthProvider): string {
	return provider?.name ?? "this provider";
}

function apiKeyLabel(provider: AuthProvider): string {
	if (!provider) return "Enter an API key";
	return `Enter ${authProviderName(provider)} API key`;
}

function envVarLabel(provider: AuthProvider, apiKeyEnvVar?: string): string {
	if (!provider) return "Use an existing environment variable";
	return `Use ${apiKeyEnvVar ?? provider.envVar} or another environment variable`;
}

function oauthLabel(provider: AuthProvider): string {
	if (!provider) return "Use ChatGPT OAuth access token";
	return `Use ChatGPT OAuth access token (${CHATGPT_OAUTH_ENV_VAR})`;
}

const CUSTOM_API_KEY_AUTH_SHORTCUT_ITEMS = [
	{
		type: "key" as const,
		mapping: {
			a: {
				label: "Enter an API key",
				value: "apiKey" as const,
			},
			e: {
				label: "Use an existing environment variable",
				value: "envVar" as const,
			},
			c: {
				label: "Use a secret command (pass, op, gopass)",
				value: "command" as const,
			},
			b: {
				label: "Back",
				value: "back" as const,
			},
		},
	},
] satisfies ShortcutArray<AuthChoiceRoute | "back">;

function buildApiKeyAuthShortcutItems(
	provider: AuthProvider,
	apiKeyEnvVar?: string,
): ShortcutArray<AuthChoiceRoute | "back"> {
	if (!provider && apiKeyEnvVar === undefined)
		return CUSTOM_API_KEY_AUTH_SHORTCUT_ITEMS;
	return [
		{
			type: "key" as const,
			mapping: {
				a: {
					label: apiKeyLabel(provider),
					value: "apiKey" as const,
				},
				e: {
					label: envVarLabel(provider, apiKeyEnvVar),
					value: "envVar" as const,
				},
				c: {
					label: "Use a secret command (pass, op, gopass)",
					value: "command" as const,
				},
				b: {
					label: "Back",
					value: "back" as const,
				},
			},
		},
	];
}

function buildOpenAiAuthShortcutItems(
	provider: AuthProvider,
	apiKeyEnvVar?: string,
): ShortcutArray<AuthChoiceRoute | "back"> {
	return [
		{
			type: "key" as const,
			mapping: {
				o: {
					label: oauthLabel(provider),
					value: "chatGptOAuth" as const,
				},
				a: {
					label: apiKeyLabel(provider),
					value: "apiKey" as const,
				},
				e: {
					label: envVarLabel(provider, apiKeyEnvVar),
					value: "envVar" as const,
				},
				c: {
					label: "Use a secret command (pass, op, gopass)",
					value: "command" as const,
				},
				b: {
					label: "Back",
					value: "back" as const,
				},
			},
		},
	];
}

function buildOAuthAuthShortcutItems(
	provider: AuthProvider,
): ShortcutArray<AuthChoiceRoute | "back"> {
	return [
		{
			type: "key" as const,
			mapping: {
				o: {
					label: oauthLabel(provider),
					value: "chatGptOAuth" as const,
				},
				b: {
					label: "Back",
					value: "back" as const,
				},
			},
		},
	];
}

const BACK_ONLY_AUTH_SHORTCUT_ITEMS = [
	{
		type: "key" as const,
		mapping: {
			b: {
				label: "Back",
				value: "back" as const,
			},
		},
	},
] satisfies ShortcutArray<AuthChoiceRoute | "back">;

export function authShortcutItemsForSupport(
	supportsApiKey: boolean,
	supportsChatGptOAuth: boolean,
	provider: AuthProvider,
	apiKeyEnvVar?: string,
): ShortcutArray<AuthChoiceRoute | "back"> {
	if (supportsChatGptOAuth && supportsApiKey) {
		return buildOpenAiAuthShortcutItems(provider, apiKeyEnvVar);
	}
	if (supportsChatGptOAuth) return buildOAuthAuthShortcutItems(provider);
	if (supportsApiKey)
		return buildApiKeyAuthShortcutItems(provider, apiKeyEnvVar);
	return BACK_ONLY_AUTH_SHORTCUT_ITEMS;
}

function dualAuthApiKeyEnvVarDescription(
	provider: RequiredAuthProvider,
	apiKeyEnvVar: string,
): string {
	return apiKeyEnvVar === provider.envVar
		? `the default API-key environment variable ${apiKeyEnvVar}`
		: `API-key environment variable ${apiKeyEnvVar}`;
}

function chatGptOAuthEnvVarDescription(): string {
	return `${CHATGPT_OAUTH_ENV_VAR} or legacy ${LEGACY_CHATGPT_OAUTH_ENV_VAR}`;
}

function apiKeyOnlyPromptText(
	provider: RequiredAuthProvider,
	apiKeyEnvVar: string,
): string {
	return apiKeyEnvVar === provider.envVar
		? `It looks like you don't have the default ${apiKeyEnvVar} environment variable defined in your current shell.`
		: `It looks like you don't have API-key environment variable ${apiKeyEnvVar} defined in your current shell.`;
}

export function authPromptText(
	provider: RequiredAuthProvider,
	supportsApiKey: boolean,
	supportsChatGptOAuth: boolean,
	apiKeyEnvVar: string,
): string {
	if (supportsChatGptOAuth && supportsApiKey) {
		return `${provider.name} can use ${providerAuthText(provider)}. Neither ${chatGptOAuthEnvVarDescription()} nor ${dualAuthApiKeyEnvVarDescription(provider, apiKeyEnvVar)} is defined in your current shell.`;
	}
	if (supportsChatGptOAuth) {
		return `${provider.name} can use ${providerAuthText(provider)}.`;
	}
	if (supportsApiKey) {
		return apiKeyOnlyPromptText(provider, apiKeyEnvVar);
	}
	return `${provider.name} does not advertise a supported authentication method in the provider catalog.`;
}

export function authSupportDetailText(
	providerName: string,
	supportsApiKey: boolean,
): string {
	if (supportsApiKey) {
		return `${providerName} supports ChatGPT OAuth in the catalog. OAuth token, API-key, environment-variable, and command setup are available here.`;
	}
	return `${providerName} supports ChatGPT OAuth in the catalog. OAuth token setup is available here.`;
}
