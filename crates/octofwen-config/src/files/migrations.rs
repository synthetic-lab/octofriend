use serde_json::{Map, Value};

use crate::models::{PROVIDERS, ProviderModelConfig};

pub const CURRENT_CONFIG_VERSION: u64 = 2;

pub fn migrate_config(raw: Value) -> Value {
    let version = raw
        .get("configVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let mut migrated = raw;

    if version < 1 {
        migrated = migrate_model_modalities(migrated);
    }
    if version < 2 {
        migrated = migrate_notifications(migrated);
    }

    set_object_field(
        &mut migrated,
        "configVersion",
        Value::from(CURRENT_CONFIG_VERSION),
    );
    migrated
}

fn migrate_model_modalities(mut raw: Value) -> Value {
    let Some(models) = raw.get_mut("models").and_then(Value::as_array_mut) else {
        return raw;
    };
    for model in models {
        let Some(model_object) = model.as_object_mut() else {
            continue;
        };
        let Some(base_url) = model_object.get("baseUrl").and_then(Value::as_str) else {
            continue;
        };
        let Some(model_name) = model_object.get("model").and_then(Value::as_str) else {
            continue;
        };
        let Some(canonical) = canonical_model(base_url, model_name) else {
            continue;
        };
        if let Some(modalities) = modalities_value(canonical) {
            model_object.insert("modalities".into(), modalities);
        }
    }
    raw
}

fn canonical_model(base_url: &str, model_name: &str) -> Option<&'static ProviderModelConfig> {
    PROVIDERS
        .iter()
        .find(|provider| provider.base_url == base_url)
        .and_then(|provider| {
            provider
                .models
                .iter()
                .find(|model| model.model == model_name)
        })
}

fn modalities_value(model: &ProviderModelConfig) -> Option<Value> {
    let modalities = model.modalities?;
    let image = modalities.image?;
    let mut image_object = Map::new();
    image_object.insert("enabled".into(), Value::Bool(image.enabled));
    image_object.insert("maxSizeMB".into(), Value::from(image.max_size_mb));
    image_object.insert(
        "acceptedMimeTypes".into(),
        Value::Array(
            image
                .accepted_mime_types
                .iter()
                .map(|mime| Value::String((*mime).into()))
                .collect(),
        ),
    );
    let mut modalities_object = Map::new();
    modalities_object.insert("image".into(), Value::Object(image_object));
    Some(Value::Object(modalities_object))
}

fn migrate_notifications(mut raw: Value) -> Value {
    let Some(notify_command) = raw.get("notifyFinishCommand").cloned() else {
        return raw;
    };
    let Some(object) = raw.as_object_mut() else {
        return raw;
    };
    object.remove("notifyFinishCommand");
    let mut notifications = Map::new();
    notifications.insert("notifyCommand".into(), notify_command);
    object.insert("notifications".into(), Value::Object(notifications));
    raw
}

fn set_object_field(value: &mut Value, key: &str, field: Value) {
    if !value.is_object() {
        *value = Value::Object(Map::new());
    }
    if let Some(object) = value.as_object_mut() {
        object.insert(key.into(), field);
    }
}
