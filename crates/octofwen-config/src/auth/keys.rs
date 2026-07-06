use std::collections::BTreeMap;

use crate::models::{ProviderConfig, key_from_name, provider_for_base_url};

pub const SYNTHETIC_BASE_URLS: &[&str] = &[
    "https://api.synthetic.new/openai/v1",
    "https://synthetic.new/api/openai/v1",
    "https://api.synthetic.new/v1",
    "https://api.glhf.chat/v1",
    "https://glhf.chat/api/v1",
    "https://glhf.chat/api/openai/v1",
];

pub fn default_env_var(
    provider: &ProviderConfig,
    overrides: Option<&BTreeMap<String, String>>,
) -> String {
    let Ok(key) = key_from_name(provider.name) else {
        return provider.env_var.to_owned();
    };
    let key = key.as_config_key();
    overrides
        .and_then(|values| values.get(key))
        .cloned()
        .unwrap_or_else(|| provider.env_var.to_owned())
}

pub fn provider_env_var_for_base_url(
    base_url: &str,
    overrides: Option<&BTreeMap<String, String>>,
) -> Option<String> {
    provider_for_base_url(base_url).map(|provider| default_env_var(provider, overrides))
}

pub fn is_synthetic_base_url(base_url: &str) -> bool {
    SYNTHETIC_BASE_URLS.contains(&base_url)
}
