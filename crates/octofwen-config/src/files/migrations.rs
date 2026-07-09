use serde_json::{Map, Value};

use crate::auth::default_env_var;
use crate::files::api_key_overrides::{ApiKeyOverrideMap, default_api_key_overrides};
use crate::files::env_var::env_auth;
use crate::models::{
    PROVIDERS, ProviderConfig, ProviderKey, ProviderKind, ProviderModelConfig, base_urls_match,
    provider_for_model_object,
};

pub const CURRENT_CONFIG_VERSION: u64 = 6;

const DEFAULT_LEGACY_MODEL_CONTEXT: u32 = 128_000;
const DEFAULT_LEGACY_USER_NAME: &str = "unknown";
const CHATGPT_OAUTH_ENV_VAR: &str = "CODEX_ACCESS_TOKEN";
const LEGACY_OPENAI_CODEX_OAUTH_ENV_VAR: &str = "OPENAI_CODEX_ACCESS_TOKEN";
const LEGACY_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api/codex";
const AUTOFIX_MODEL_KEYS: [&str; 2] = ["diffApply", "fixJson"];

type JsonObject = Map<String, Value>;

pub fn migrate_config(raw: Value) -> Value {
    let version = raw
        .get("configVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let mut migrated = migrate_legacy_codex_models(raw);

    if version < 1 {
        migrated = migrate_model_modalities(migrated);
    }
    if version < 2 {
        migrated = migrate_notifications(migrated);
    }
    if version < 3 {
        migrated = migrate_legacy_autofix_json(migrated);
        migrated = migrate_api_env_var_auth(migrated);
    }
    if version < 4 {
        migrated = migrate_missing_model_context(migrated);
    }
    if version < 5 {
        migrated = migrate_missing_provider_type(migrated);
    }
    if version < 6 {
        migrated = migrate_notifications(migrated);
        migrated = migrate_legacy_autofix_json(migrated);
        migrated = migrate_missing_provider_type(migrated);
        migrated = migrate_api_env_var_auth(migrated);
    }
    migrated = migrate_missing_required_defaults(migrated);

    set_object_field(
        &mut migrated,
        "configVersion",
        Value::from(CURRENT_CONFIG_VERSION),
    );
    migrated
}

fn migrate_missing_required_defaults(mut raw: Value) -> Value {
    if !raw.is_object() {
        raw = Value::Object(Map::new());
    }
    let Some(object) = raw.as_object_mut() else {
        return raw;
    };
    if !object.get("yourName").is_some_and(Value::is_string) {
        object.insert(
            "yourName".into(),
            Value::String(DEFAULT_LEGACY_USER_NAME.into()),
        );
    }
    if !object.get("models").is_some_and(Value::is_array) {
        object.insert("models".into(), Value::Array(Vec::new()));
    }
    raw
}

fn migrate_legacy_codex_models(mut raw: Value) -> Value {
    if let Some(models) = raw.get_mut("models").and_then(Value::as_array_mut) {
        for model in models {
            migrate_legacy_codex_model(model);
        }
    }
    for key in AUTOFIX_MODEL_KEYS {
        if let Some(model) = raw.get_mut(key) {
            migrate_legacy_codex_model(model);
        }
    }
    raw
}

fn migrate_legacy_codex_model(model: &mut Value) {
    let Some(object) = model.as_object_mut() else {
        return;
    };
    if !is_legacy_codex_model(object) {
        return;
    }
    let openai = crate::models::provider_for_key(ProviderKey::OpenAi);
    object.insert("type".into(), Value::String("openai-responses".into()));
    object.insert(
        "baseUrl".into(),
        Value::String(openai.connection.base_url.into()),
    );
    let replace_auth = object
        .get("auth")
        .and_then(Value::as_object)
        .is_none_or(|auth| auth.get("type").and_then(Value::as_str) == Some("codex"));
    if replace_auth {
        object.insert(
            "auth".into(),
            env_auth(CHATGPT_OAUTH_ENV_VAR, "chatgpt-oauth"),
        );
    } else {
        migrate_model_env_auth_credential(object);
    }
}

fn is_legacy_codex_model(object: &JsonObject) -> bool {
    object.get("type").and_then(Value::as_str) == Some("codex")
        || object
            .get("baseUrl")
            .and_then(Value::as_str)
            .is_some_and(|base_url| base_urls_match(base_url, LEGACY_CODEX_BASE_URL))
}

fn migrate_api_env_var_auth(mut raw: Value) -> Value {
    let overrides = default_api_key_overrides(&raw);
    if let Some(models) = raw.get_mut("models").and_then(Value::as_array_mut) {
        for model in models {
            migrate_model_api_env_var_auth(model, &overrides);
        }
    }
    for key in AUTOFIX_MODEL_KEYS {
        if let Some(model) = raw.get_mut(key) {
            migrate_model_api_env_var_auth(model, &overrides);
        }
    }
    if let Some(search) = raw.get_mut("search") {
        migrate_search_api_env_var_auth(search);
    }
    raw
}

fn migrate_model_api_env_var_auth(model: &mut Value, overrides: &ApiKeyOverrideMap) {
    let Some(object) = model.as_object_mut() else {
        return;
    };
    if object.contains_key("auth") {
        migrate_model_env_auth_credential(object);
        object.remove("apiEnvVar");
        return;
    }
    let Some(api_env_var) = object
        .get("apiEnvVar")
        .and_then(Value::as_str)
        .map(str::trim)
    else {
        return;
    };
    if api_env_var.is_empty() || api_env_var == expected_model_env_var(object, overrides) {
        object.remove("apiEnvVar");
        return;
    }
    let auth = env_auth(api_env_var, "api-key");
    object.remove("apiEnvVar");
    object.insert("auth".into(), auth);
}

fn expected_model_env_var(object: &JsonObject, overrides: &ApiKeyOverrideMap) -> String {
    provider_for_model_object(object)
        .or_else(|| provider_from_model_env_hint(object, overrides))
        .map(|provider| default_env_var(provider, Some(overrides)))
        .unwrap_or_default()
}

fn migrate_search_api_env_var_auth(search: &mut Value) {
    let Some(object) = search.as_object_mut() else {
        return;
    };
    if object.contains_key("auth") {
        migrate_env_auth_credential(object.get_mut("auth"), "api-key");
        object.remove("apiEnvVar");
        return;
    }
    let Some(api_env_var) = object
        .remove("apiEnvVar")
        .and_then(|value| value.as_str().map(|value| value.trim().to_string()))
    else {
        return;
    };
    if api_env_var.is_empty() {
        return;
    }
    object.insert("auth".into(), env_auth(&api_env_var, "api-key"));
}

fn migrate_model_env_auth_credential(model: &mut JsonObject) {
    let credential = model
        .get("auth")
        .and_then(Value::as_object)
        .and_then(|auth| auth.get("name"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| is_chatgpt_oauth_env_var(name))
        .and_then(|_| provider_for_model_object(model))
        .filter(|provider| provider.kind == ProviderKind::OpenAiResponses)
        .map_or("api-key", |_| "chatgpt-oauth");
    migrate_env_auth_credential(model.get_mut("auth"), credential);
}

fn is_chatgpt_oauth_env_var(name: &str) -> bool {
    name == CHATGPT_OAUTH_ENV_VAR || name == LEGACY_OPENAI_CODEX_OAUTH_ENV_VAR
}

fn migrate_env_auth_credential(auth: Option<&mut Value>, credential: &str) {
    let Some(auth) = auth.and_then(Value::as_object_mut) else {
        return;
    };
    if auth.get("type").and_then(Value::as_str) != Some("env") {
        return;
    }
    trim_env_auth_name(auth);
    if auth.contains_key("credential") {
        return;
    }
    auth.insert("credential".into(), Value::String(credential.into()));
}

fn trim_env_auth_name(auth: &mut JsonObject) {
    let Some(name) = auth.get("name").and_then(Value::as_str) else {
        return;
    };
    let trimmed = name.trim();
    if trimmed.len() != name.len() {
        auth.insert("name".into(), Value::String(trimmed.into()));
    }
}

fn migrate_model_modalities(mut raw: Value) -> Value {
    let Some(models) = raw.get_mut("models").and_then(Value::as_array_mut) else {
        return raw;
    };
    for model in models {
        let Some(model_object) = model.as_object_mut() else {
            continue;
        };
        let Some(canonical) = canonical_model(model_object) else {
            continue;
        };
        if let Some(modalities) = modalities_value(canonical) {
            model_object.insert("modalities".into(), modalities);
        }
    }
    raw
}

fn migrate_missing_model_context(mut raw: Value) -> Value {
    let Some(models) = raw.get_mut("models").and_then(Value::as_array_mut) else {
        return raw;
    };
    for model in models {
        let Some(model_object) = model.as_object_mut() else {
            continue;
        };
        if model_object.get("context").is_some_and(Value::is_number) {
            continue;
        }
        let context = canonical_model(model_object)
            .map(|model| model.context)
            .unwrap_or(DEFAULT_LEGACY_MODEL_CONTEXT);
        model_object.insert("context".into(), Value::from(context));
    }
    raw
}

fn migrate_missing_provider_type(mut raw: Value) -> Value {
    let overrides = default_api_key_overrides(&raw);
    if let Some(models) = raw.get_mut("models").and_then(Value::as_array_mut) {
        for model in models {
            migrate_model_provider_type(model, &overrides);
        }
    }
    for key in AUTOFIX_MODEL_KEYS {
        if let Some(model) = raw.get_mut(key) {
            migrate_model_provider_type(model, &overrides);
        }
    }
    raw
}

fn migrate_model_provider_type(model: &mut Value, overrides: &ApiKeyOverrideMap) {
    let Some(model_object) = model.as_object_mut() else {
        return;
    };
    if model_object.get("type").is_some() {
        return;
    }
    let provider = provider_for_model_object(model_object)
        .or_else(|| provider_from_model_env_hint(model_object, overrides));
    let Some(provider_type) =
        provider.and_then(|provider| provider_kind_config_type(provider.kind))
    else {
        return;
    };
    model_object.insert("type".into(), Value::String(provider_type.into()));
}

fn provider_from_model_env_hint(
    object: &JsonObject,
    overrides: &ApiKeyOverrideMap,
) -> Option<&'static ProviderConfig> {
    let env_name = object
        .get("apiEnvVar")
        .and_then(Value::as_str)
        .or_else(|| {
            object
                .get("auth")
                .and_then(Value::as_object)
                .filter(|auth| auth.get("type").and_then(Value::as_str) == Some("env"))
                .and_then(|auth| auth.get("name").and_then(Value::as_str))
        })?
        .trim();
    if env_name.is_empty() {
        return None;
    }
    PROVIDERS.iter().find(|provider| {
        provider.connection.env_var == env_name
            || overrides
                .get(provider.key.as_config_key())
                .is_some_and(|override_env_name| override_env_name == env_name)
    })
}

fn migrate_legacy_autofix_json(mut raw: Value) -> Value {
    let overrides = default_api_key_overrides(&raw);
    let Some(object) = raw.as_object_mut() else {
        return raw;
    };
    let Some(mut legacy_autofix_json) = object.remove("autofixJson") else {
        return raw;
    };
    migrate_legacy_codex_model(&mut legacy_autofix_json);
    migrate_model_provider_type(&mut legacy_autofix_json, &overrides);
    migrate_model_api_env_var_auth(&mut legacy_autofix_json, &overrides);
    object.entry("fixJson").or_insert(legacy_autofix_json);
    raw
}

fn provider_kind_config_type(kind: ProviderKind) -> Option<&'static str> {
    match kind {
        ProviderKind::Standard => None,
        ProviderKind::OpenAiResponses => Some("openai-responses"),
        ProviderKind::Anthropic => Some("anthropic"),
        ProviderKind::Gemini => Some("gemini"),
    }
}

fn canonical_model(object: &JsonObject) -> Option<&'static ProviderModelConfig> {
    let model_name = object.get("model").and_then(Value::as_str)?;
    provider_for_model_object(object).and_then(|provider| {
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
    let notifications = object
        .entry("notifications")
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(notifications) = notifications.as_object_mut() {
        notifications
            .entry("notifyCommand")
            .or_insert(notify_command);
    }
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
