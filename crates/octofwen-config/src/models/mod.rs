pub mod catalog;
pub mod selection;

pub use catalog::{
    DEFAULT_MULTIMODAL_IMAGE_MODEL_EXAMPLE, ImageModalityConfig, MissingProviderName,
    MultimodalConfig, PROVIDERS, ProviderConfig, ProviderKey, ProviderKind, ProviderModelConfig,
    ReasoningLevel, SYNTHETIC_PROVIDER, key_from_name, provider_for_base_url, provider_for_key,
    recommended_model,
};
pub use selection::{ModelConfig, model_from_config, selected_model_from_config};
