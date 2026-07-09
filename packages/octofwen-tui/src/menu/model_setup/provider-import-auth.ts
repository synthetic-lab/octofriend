import type { Auth, Config } from "../../internal/configuration/schemas.ts";
import type { ProviderConfig } from "../../internal/model-provider-catalog/main.ts";
import { supportsAuthMethod } from "./provider-auth.ts";
import { resolveProviderEnvVar } from "./provider-helpers.ts";

type BuildImportedProviderModelsInput = {
	models: ProviderConfig["models"];
	provider: ProviderConfig;
	config: Config | null;
	overrideAuth: Auth | null;
	useEnvVar: boolean;
};

type ProviderModelAuthInput = {
	provider: ProviderConfig;
	config: Config | null;
	overrideAuth: Auth | null;
	useEnvVar: boolean;
};

function importedProviderModel({
	model,
	provider,
	auth,
}: {
	model: ProviderConfig["models"][number];
	provider: ProviderConfig;
	auth: Auth | undefined;
}): Config["models"][number] {
	const base = {
		...model,
		nickname: `${model.nickname} (${provider.name})`,
		baseUrl: provider.baseUrl,
	};
	const withType = provider.type ? { ...base, type: provider.type } : base;
	return auth ? { ...withType, auth } : withType;
}

export function buildImportedProviderModels(
	input: BuildImportedProviderModelsInput,
): Config["models"] {
	const { models, provider } = input;
	if (models.length === 0) return [];
	const imported = new Array<Config["models"][number]>(models.length);
	const importAuth = providerModelAuth(input);
	let index = 0;
	let importedIndex = 0;
	while (index < models.length) {
		const model = models[index];
		index += 1;
		if (model === undefined) continue;
		imported[importedIndex] = importedProviderModel({
			model,
			provider,
			auth: importAuth,
		});
		importedIndex += 1;
	}
	imported.length = importedIndex;
	return imported;
}

export function providerImportAuthText(input: ProviderModelAuthInput): string {
	const auth = input.overrideAuth;
	if (auth && !supportsProviderAuth(input.provider, auth)) {
		return "Authentication: not supported for this provider";
	}
	if (auth?.type === "command") {
		return "Authentication: API key from command";
	}
	if (auth?.type === "env") {
		const name = auth.name.trim();
		if (name.length === 0) {
			return "Authentication: not configured";
		}
		return (auth.credential ?? "api-key") === "chatgpt-oauth"
			? `Authentication: ChatGPT OAuth via ${name}`
			: `Authentication: API key via ${name}`;
	}
	if (
		input.useEnvVar &&
		supportsAuthMethod(input.provider.authMethods, "api-key")
	) {
		return `Authentication: API key via ${resolveProviderEnvVar(
			input.provider,
			input.config,
			null,
		)}`;
	}
	return "Authentication: not configured";
}

export function providerModelAuth(
	input: ProviderModelAuthInput,
): Auth | undefined {
	if (input.overrideAuth) {
		if (!supportsProviderAuth(input.provider, input.overrideAuth))
			return undefined;
		if (input.overrideAuth.type === "env") {
			const name = input.overrideAuth.name.trim();
			if (name.length === 0) return undefined;
			if ((input.overrideAuth.credential ?? "api-key") === "api-key") {
				return undefined;
			}
			return name === input.overrideAuth.name
				? input.overrideAuth
				: { ...input.overrideAuth, name };
		}
		return input.overrideAuth;
	}
	return undefined;
}

function supportsProviderAuth(provider: ProviderConfig, auth: Auth): boolean {
	if (auth.type === "command") {
		return supportsAuthMethod(provider.authMethods, "api-key");
	}

	return supportsAuthMethod(provider.authMethods, auth.credential ?? "api-key");
}
