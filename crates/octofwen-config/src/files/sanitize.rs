use std::collections::BTreeMap;

use serde_json::{Map, Value};

use crate::auth::default_env_var;
use crate::files::api_key_overrides::default_api_key_overrides;
use crate::files::migrations::CURRENT_CONFIG_VERSION;
use crate::models::provider_for_model_object;

pub fn sanitize_config(mut config: Value) -> Value {
    if !config.is_object() {
        config = Value::Object(Map::default());
    }
    normalize_default_api_key_overrides(&mut config);
    let overrides = default_api_key_overrides(&config);
    if let Some(models) = config.get_mut("models").and_then(Value::as_array_mut) {
        for model in models {
            omit_default_api_env_var(model, &overrides);
        }
    }
    for key in ["diffApply", "fixJson"] {
        if let Some(model) = config.get_mut(key) {
            omit_default_api_env_var(model, &overrides);
        }
    }
    if let Some(object) = config.as_object_mut() {
        object.insert("configVersion".into(), Value::from(CURRENT_CONFIG_VERSION));
    }
    config
}

fn normalize_default_api_key_overrides(config: &mut Value) {
    let Some(object) = config.as_object_mut() else {
        return;
    };
    let Some(overrides) = object
        .get_mut("defaultApiKeyOverrides")
        .and_then(Value::as_object_mut)
    else {
        object.remove("defaultApiKeyOverrides");
        return;
    };
    overrides.retain(|_, value| {
        let Some(raw) = value.as_str() else {
            return false;
        };
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return false;
        }
        if trimmed.len() != raw.len() {
            *value = Value::String(trimmed.into());
        }
        true
    });
    if overrides.is_empty() {
        object.remove("defaultApiKeyOverrides");
    }
}

pub fn omit_default_api_env_var(model: &mut Value, overrides: &BTreeMap<String, String>) {
    let Some(object) = model.as_object_mut() else {
        return;
    };
    if object.contains_key("auth") {
        object.remove("apiEnvVar");
        return;
    }
    let Some(api_env_var) = normalized_api_env_var(object) else {
        return;
    };
    let Some(provider) = provider_for_model_object(object) else {
        return;
    };
    let expected = default_env_var(provider, Some(overrides));
    if expected == api_env_var {
        object.remove("apiEnvVar");
    }
}

fn normalized_api_env_var(object: &mut Map<String, Value>) -> Option<String> {
    let api_env_var = object.get("apiEnvVar").and_then(Value::as_str)?;
    let trimmed = api_env_var.trim().to_string();
    if trimmed.is_empty() {
        object.remove("apiEnvVar");
        return None;
    }
    if trimmed.len() != api_env_var.len() {
        object.insert("apiEnvVar".into(), Value::String(trimmed.clone()));
    }
    Some(trimmed)
}
