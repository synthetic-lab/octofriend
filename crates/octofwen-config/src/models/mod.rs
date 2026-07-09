pub mod catalog;
pub mod selection;

pub use catalog::{
    DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE, ImageModalityConfig, MissingProviderName,
    MultimodalConfig, PROVIDERS, ProviderAuthMethod, ProviderConfig, ProviderConnectionConfig,
    ProviderKey, ProviderKind, ProviderModelConfig, ReasoningLevel, SYNTHETIC_PROVIDER,
    base_urls_match, key_from_name, provider_for_base_url, provider_for_key,
    provider_for_model_object, provider_for_type, recommended_model,
};
pub use selection::{ModelConfig, model_from_config, selected_model_from_config};
