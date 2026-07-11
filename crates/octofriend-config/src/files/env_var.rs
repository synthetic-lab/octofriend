use serde_json::{Map, Value};

use crate::files::api_keys::default_overrides;
use crate::models::provider_for_model_object;

pub const AUTOFIX_KEYS: &[&str] = &["diffApply", "fixJson"];

pub fn merge_env_var(mut config: Value, model: &Value, api_env_var: &str) -> Option<Value> {
    let api_env_var = api_env_var.trim();
    if api_env_var.is_empty() {
        return None;
    }
    let index = config
        .get("models")?
        .as_array()?
        .iter()
        .position(|entry| entry == model)?;
    if let Some(provider) = model.as_object().and_then(provider_for_model_object) {
        let provider_key = provider.key.as_config_key().to_string();
        let overrides = default_overrides(&config);
        let default_env_var = crate::auth::default_env_var(provider, Some(&overrides));
        if default_env_var == api_env_var {
            let object = config.as_object_mut()?;
            if let Some(model) = object
                .get_mut("models")?
                .as_array_mut()?
                .get_mut(index)?
                .as_object_mut()
            {
                model.remove("apiEnvVar");
                model.remove("auth");
            }
            return Some(config);
        }
        let object = config.as_object_mut()?;
        let overrides = object
            .entry("defaultApiKeyOverrides")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()?;
        overrides.insert(provider_key, Value::String(api_env_var.to_string()));
        if let Some(model) = object
            .get_mut("models")?
            .as_array_mut()?
            .get_mut(index)?
            .as_object_mut()
        {
            model.remove("apiEnvVar");
            model.remove("auth");
        }
        return Some(config);
    }
    let mut merged_model = model.clone();
    let object = merged_model.as_object_mut()?;
    object.remove("apiEnvVar");
    object.insert("auth".into(), env_auth(api_env_var, "api-key"));
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
    let api_env_var = api_env_var.trim();
    if api_env_var.is_empty() {
        return None;
    }
    if let Some(provider) = model.as_object().and_then(provider_for_model_object) {
        let provider_key = provider.key.as_config_key().to_string();
        let overrides = default_overrides(&config);
        let default_env_var = crate::auth::default_env_var(provider, Some(&overrides));
        if default_env_var == api_env_var {
            if let Some(model) = config
                .as_object_mut()?
                .get_mut(key)
                .and_then(Value::as_object_mut)
            {
                model.remove("apiEnvVar");
                model.remove("auth");
            }
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
            model.remove("auth");
        }
        return Some(config);
    }
    let mut merged_model = model.clone();
    let object = merged_model.as_object_mut()?;
    object.remove("apiEnvVar");
    object.insert("auth".into(), env_auth(api_env_var, "api-key"));
    config
        .as_object_mut()?
        .insert(key.to_string(), merged_model);
    Some(config)
}

pub(super) fn env_auth(api_env_var: &str, credential: &str) -> Value {
    let mut auth = Map::new();
    auth.insert("type".into(), Value::String("env".into()));
    auth.insert("name".into(), Value::String(api_env_var.to_string()));
    auth.insert("credential".into(), Value::String(credential.into()));
    Value::Object(auth)
}
