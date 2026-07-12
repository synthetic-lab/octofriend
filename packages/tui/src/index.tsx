import type {
	CanDisplayImageResult,
	ImageModalityConfig,
	MultimodalConfig,
	ProviderAuthMethod,
	ProviderConfig,
	ProviderKey,
	ProviderModelConfig,
	ProviderShortcut,
} from "./runtime/models/catalog/main.ts";
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
} from "./runtime/models/catalog/main.ts";
import {
	PreflightAutofixAuth,
	PreflightModelAuth,
} from "./shell/auth-check/main.tsx";
import { FirstTimeSetup } from "./shell/setup/main.tsx";
import { App } from "./shell/shell.tsx";

export type {
	ConversationSessionHistory,
	SaveConversationSession,
} from "./shell/session.ts";
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
