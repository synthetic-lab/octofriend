use std::collections::BTreeMap;

use serde_json::Value;

use crate::models::{
    ProviderConfig, ProviderKey, key_from_name, provider_for_base_url, provider_for_key,
};

pub type ApiKeyMap = BTreeMap<String, String>;

pub fn parse_api_key_map(contents: &str) -> ApiKeyMap {
    json5::from_str::<Value>(contents)
        .or_else(|_| serde_json::from_str::<Value>(contents))
        .map(api_key_map_from_value)
        .unwrap_or_default()
}

pub fn api_key_map_from_value(value: Value) -> ApiKeyMap {
    value
        .as_object()
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    let key = key.trim();
                    if key.is_empty() {
                        return None;
                    }
                    let api_key = value.as_str()?.trim();
                    if api_key.is_empty() {
                        None
                    } else {
                        Some((key.to_string(), api_key.to_string()))
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

pub const SYNTHETIC_BASE_URLS: &[&str] = &[
    "https://api.synthetic.new/openai/v1",
    "https://synthetic.new/api/openai/v1",
    "https://api.synthetic.new/v1",
    "https://api.glhf.chat/v1",
    "https://glhf.chat/api/v1",
    "https://glhf.chat/api/openai/v1",
];

pub fn default_env_var(provider: &ProviderConfig, overrides: Option<&ApiKeyMap>) -> String {
    let Ok(key) = key_from_name(provider.name) else {
        return provider.connection.env_var.to_owned();
    };
    let key = key.as_config_key();
    overrides
        .and_then(|values| values.get(key))
        .and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        })
        .unwrap_or_else(|| provider.connection.env_var.to_owned())
}

pub fn provider_env_var_for_base_url(
    base_url: &str,
    overrides: Option<&ApiKeyMap>,
) -> Option<String> {
    provider_for_base_url(base_url)
        .or_else(|| {
            is_synthetic_base_url(base_url).then(|| provider_for_key(ProviderKey::Synthetic))
        })
        .map(|provider| default_env_var(provider, overrides))
}

pub fn is_synthetic_base_url(base_url: &str) -> bool {
    SYNTHETIC_BASE_URLS
        .iter()
        .any(|synthetic_base_url| crate::models::base_urls_match(synthetic_base_url, base_url))
}
