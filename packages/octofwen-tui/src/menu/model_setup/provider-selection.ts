import type { Keymap, ShortcutArray } from "../../input/shortcuts.tsx";
import type { Config } from "../../internal/configuration/schemas.ts";
import {
	PROVIDERS,
	type ProviderConfig,
	type ProviderKey,
	providerEntries,
	providerWithResolvedBaseUrl,
} from "../../internal/model-provider-catalog/main.ts";
import {
	authChoicesForProvider,
	detectExistingProviderAuth,
	providerAuthShortcutText,
} from "./provider-auth.ts";
import { resolveProviderEnvVar } from "./provider-helpers.ts";
import type { ModelSetupStepData } from "./setup-state.ts";

export type FastProviderValue = ProviderKey | "custom" | "back";

type ProviderEntry = readonly [ProviderKey, ProviderConfig];

export function providerShortcutLabel(
	provider: ProviderConfig,
	config: Pick<Config, "defaultApiKeyOverrides"> | null = null,
): string {
	const model = provider.models[0];
	const modelText = model ? ` · ${model.nickname}` : "";
	const { supportsApiKey } = authChoicesForProvider(provider);
	const apiKeyEnvVar = supportsApiKey
		? resolveProviderEnvVar(provider, config, null)
		: provider.envVar;
	return `${provider.name} · ${providerAuthShortcutText(provider, apiKeyEnvVar)}${modelText}`;
}

export function buildFastProviderShortcutItems(
	entries: readonly ProviderEntry[] = providerEntries(),
	config: Pick<Config, "defaultApiKeyOverrides"> | null = null,
): ShortcutArray<FastProviderValue> {
	const mapping: Keymap<FastProviderValue> = {};
	for (const [key, provider] of entries) {
		mapping[provider.shortcut] = {
			label: providerShortcutLabel(provider, config),
			value: key,
		};
	}
	mapping.c = {
		label: "Add a custom model...",
		value: "custom",
	};
	mapping.b = {
		label: "Back",
		value: "back",
	};
	return [
		{
			type: "key",
			mapping,
		},
	];
}

export const FAST_PROVIDER_SHORTCUT_ITEMS = buildFastProviderShortcutItems();

type ModelSetupStepForProviderChoiceInput = {
	providerKey: ProviderKey;
	config: Config | null;
	env?: Record<string, string | undefined>;
};

export function modelSetupStepForProviderChoice(
	input: ModelSetupStepForProviderChoiceInput,
): Extract<ModelSetupStepData, { step: "found" | "missing" }> | null {
	const env = input.env ?? process.env;
	const catalogProvider = PROVIDERS[input.providerKey];
	if (!catalogProvider) return null;
	const provider = providerWithResolvedBaseUrl(
		input.providerKey,
		catalogProvider,
		env,
	);
	const detectedAuth = detectExistingProviderAuth(provider, input.config, env);
	if (detectedAuth) {
		return {
			step: "found",
			provider,
			overrideAuth: detectedAuth.overrideAuth,
			useEnvVar: detectedAuth.useEnvVar,
		};
	}
	return {
		step: "missing",
		provider,
	};
}
