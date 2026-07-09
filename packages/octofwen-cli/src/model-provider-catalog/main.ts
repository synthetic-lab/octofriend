import type {
	CanDisplayImageResult,
	ImageModalityConfig,
	MultimodalConfig,
	ProviderAuthMethod,
	ProviderConfig,
	ProviderKey,
	ProviderModelConfig,
	ProviderShortcut,
} from "@octofwen/octofwen-tui";
import {
	DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE as TUI_DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	PROVIDERS as TUI_PROVIDERS,
	SYNTHETIC_PROVIDER as TUI_SYNTHETIC_PROVIDER,
	canDisplayImage as tuiCanDisplayImage,
	keyFromName as tuiKeyFromName,
	providerForBaseUrl as tuiProviderForBaseUrl,
	providerForModelConfig as tuiProviderForModelConfig,
	providerValues as tuiProviderValues,
	recommendedModel as tuiRecommendedModel,
} from "@octofwen/octofwen-tui";

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
	TUI_DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE as DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE,
	TUI_PROVIDERS as PROVIDERS,
	TUI_SYNTHETIC_PROVIDER as SYNTHETIC_PROVIDER,
	tuiCanDisplayImage as canDisplayImage,
	tuiKeyFromName as keyFromName,
	tuiProviderForBaseUrl as providerForBaseUrl,
	tuiProviderForModelConfig as providerForModelConfig,
	tuiProviderValues as providerValues,
	tuiRecommendedModel as recommendedModel,
};
