use std::collections::BTreeMap;

use serde_json::{Map, Value};

pub const AUTOFIX_KEYS: &[&str] = &["diffApply", "fixJson"];

pub fn merge_env_var(mut config: Value, model: &Value, api_env_var: &str) -> Option<Value> {
    let index = config
        .get("models")?
        .as_array()?
        .iter()
        .position(|entry| entry == model)?;
    let base_url = model.get("baseUrl")?.as_str()?;
    if let Some(provider) = crate::models::provider_for_base_url(base_url) {
        let provider_key = crate::models::key_from_name(provider.name)
            .ok()?
            .as_config_key()
            .to_string();
        let overrides = default_api_key_overrides(&config);
        let default_env_var = crate::auth::default_env_var(provider, Some(&overrides));
        if default_env_var == api_env_var {
            return Some(config);
        }
        let object = config.as_object_mut()?;
        let overrides = object
            .entry("defaultApiKeyOverrides")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()?;
        overrides.insert(provider_key, Value::String(api_env_var.to_string()));
        object
            .get_mut("models")?
            .as_array_mut()?
            .get_mut(index)?
            .as_object_mut()?
            .remove("apiEnvVar");
        return Some(config);
    }
    let mut merged_model = model.clone();
    merged_model
        .as_object_mut()?
        .insert("apiEnvVar".into(), Value::String(api_env_var.to_string()));
    config
        .get_mut("models")?
        .as_array_mut()?
        .get_mut(index)?
        .clone_from(&merged_model);
    Some(config)
}

pub fn merge_autofix_env_var(
    mut config: Value,
    key: &str,
    model: &Value,
    api_env_var: &str,
) -> Option<Value> {
    if !AUTOFIX_KEYS.contains(&key) {
        return None;
    }
    let base_url = model.get("baseUrl")?.as_str()?;
    if let Some(provider) = crate::models::provider_for_base_url(base_url) {
        let provider_key = crate::models::key_from_name(provider.name)
            .ok()?
            .as_config_key()
            .to_string();
        let overrides = default_api_key_overrides(&config);
        let default_env_var = crate::auth::default_env_var(provider, Some(&overrides));
        if default_env_var == api_env_var {
            return Some(config);
        }
        let object = config.as_object_mut()?;
        let overrides = object
            .entry("defaultApiKeyOverrides")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()?;
        overrides.insert(provider_key, Value::String(api_env_var.to_string()));
        if let Some(model) = object.get_mut(key).and_then(Value::as_object_mut) {
            model.remove("apiEnvVar");
        }
        return Some(config);
    }
    let mut merged_model = model.clone();
    merged_model
        .as_object_mut()?
        .insert("apiEnvVar".into(), Value::String(api_env_var.to_string()));
    config
        .as_object_mut()?
        .insert(key.to_string(), merged_model);
    Some(config)
}

fn default_api_key_overrides(config: &Value) -> BTreeMap<String, String> {
    config
        .as_object()
        .and_then(|config| config.get("defaultApiKeyOverrides"))
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.into())))
                .collect()
        })
        .unwrap_or_default()
}
