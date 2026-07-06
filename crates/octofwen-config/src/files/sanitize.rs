use std::collections::BTreeMap;

use serde_json::Value;

use crate::auth::default_env_var;
use crate::files::migrations::CURRENT_CONFIG_VERSION;
use crate::models::provider_for_base_url;

pub fn sanitize_config(mut config: Value) -> Value {
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
    if !config.is_object() {
        config = Value::Object(Default::default());
    }
    if let Some(object) = config.as_object_mut() {
        object.insert("configVersion".into(), Value::from(CURRENT_CONFIG_VERSION));
    }
    config
}

pub fn omit_default_api_env_var(model: &mut Value, overrides: &BTreeMap<String, String>) {
    let Some(object) = model.as_object_mut() else {
        return;
    };
    let Some(base_url) = object.get("baseUrl").and_then(Value::as_str) else {
        return;
    };
    let Some(provider) = provider_for_base_url(base_url) else {
        return;
    };
    let expected = default_env_var(provider, Some(overrides));
    let Some(api_env_var) = object.get("apiEnvVar").and_then(Value::as_str) else {
        return;
    };
    if expected == api_env_var {
        object.remove("apiEnvVar");
    }
}

fn default_api_key_overrides(config: &Value) -> BTreeMap<String, String> {
    config
        .get("defaultApiKeyOverrides")
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.into())))
                .collect()
        })
        .unwrap_or_default()
}
