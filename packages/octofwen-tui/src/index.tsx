import {
	PreflightAutofixAuth,
	PreflightModelAuth,
} from "./app/auth_preflight/main.tsx";
import { FirstTimeSetup } from "./app/first_time_setup/main.tsx";
import { App } from "./app/shell.tsx";
import type {
	CanDisplayImageResult,
	ImageModalityConfig,
	MultimodalConfig,
	ProviderAuthMethod,
	ProviderConfig,
	ProviderKey,
	ProviderModelConfig,
	ProviderShortcut,
} from "./internal/model-provider-catalog/main.ts";
import {
	canDisplayImage,
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	keyFromName,
	PROVIDERS,
	providerBaseUrlEnvVar,
	providerBaseUrlsMatch,
	providerEntries,
	providerForBaseUrl,
	providerForModelConfig,
	providerValues,
	providerWithResolvedBaseUrl,
	recommendedModel,
	resolveProviderBaseUrl,
	SYNTHETIC_PROVIDER,
	SYNTHETIC_PROVIDER_KEY,
} from "./internal/model-provider-catalog/main.ts";

export type {
	CanDisplayImageResult,
	ImageModalityConfig,
	MultimodalConfig,
	ProviderAuthMethod,
	ProviderConfig,
	ProviderKey,
	ProviderModelConfig,
	ProviderShortcut,
};
export {
	App,
	canDisplayImage,
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	FirstTimeSetup,
	keyFromName,
	PROVIDERS,
	PreflightAutofixAuth,
	PreflightModelAuth,
	providerBaseUrlEnvVar,
	providerBaseUrlsMatch,
	providerEntries,
	providerForBaseUrl,
	providerForModelConfig,
	providerValues,
	providerWithResolvedBaseUrl,
	recommendedModel,
	resolveProviderBaseUrl,
	SYNTHETIC_PROVIDER,
	SYNTHETIC_PROVIDER_KEY,
};
