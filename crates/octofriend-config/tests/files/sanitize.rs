use octofriend_config::files::{CURRENT_CONFIG_VERSION, sanitize_config};
use serde_json::json;

#[test]
fn removes_redundant_builtin_provider_env_vars_from_models_and_autofix_configs() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "models": [{
            "nickname": "GPT-5 Mini",
            "baseUrl": "https://api.openai.com/v1",
            "apiEnvVar": "OPENAI_API_KEY",
            "model": "gpt-5-mini",
            "context": 200_000
        }],
        "diffApply": {
            "baseUrl": "https://api.openai.com/v1",
            "apiEnvVar": "OPENAI_API_KEY",
            "model": "gpt-5-mini"
        }
    }));

    assert_eq!(sanitized["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
    assert!(sanitized["diffApply"].get("apiEnvVar").is_none());
}

#[test]
fn preserves_custom_provider_env_vars_and_unknown_provider_env_vars() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "models": [
            {
                "nickname": "GPT-5 Mini",
                "baseUrl": "https://api.openai.com/v1",
                "apiEnvVar": "CUSTOM_OPENAI_KEY",
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Custom",
                "baseUrl": "https://custom.invalid/v1",
                "apiEnvVar": " CUSTOM_API_KEY ",
                "model": "custom",
                "context": 1000
            }
        ]
    }));

    assert_eq!(sanitized["models"][0]["apiEnvVar"], "CUSTOM_OPENAI_KEY");
    assert_eq!(sanitized["models"][1]["apiEnvVar"], "CUSTOM_API_KEY");
}

#[test]
fn removes_blank_api_env_vars_when_sanitizing() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "models": [{
            "nickname": "Custom",
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "  ",
            "model": "custom",
            "context": 1000
        }]
    }));

    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
}

#[test]
fn honors_default_api_keys_when_sanitizing() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "openai": "CUSTOM_OPENAI_KEY" },
        "models": [{
            "nickname": "GPT-5 Mini",
            "baseUrl": "https://api.openai.com/v1",
            "apiEnvVar": " CUSTOM_OPENAI_KEY ",
            "model": "gpt-5-mini",
            "context": 200_000
        }]
    }));

    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
}

#[test]
fn trims_default_api_keys_when_sanitizing() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "defaultApiKeyOverrides": {
            "openai": " CUSTOM_OPENAI_KEY ",
            "anthropic": "  ",
            "gemini": 42
        },
        "models": [{
            "nickname": "GPT-5 Mini",
            "baseUrl": "https://api.openai.com/v1",
            "apiEnvVar": "CUSTOM_OPENAI_KEY",
            "model": "gpt-5-mini",
            "context": 200_000
        }]
    }));

    assert_eq!(
        sanitized["defaultApiKeyOverrides"],
        json!({ "openai": "CUSTOM_OPENAI_KEY" })
    );
    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
}

#[test]
fn removes_empty_default_api_keys_when_sanitizing() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "defaultApiKeyOverrides": {
            "openai": "  ",
            "anthropic": 42
        },
        "models": []
    }));

    assert!(sanitized.get("defaultApiKeyOverrides").is_none());
}

#[test]
fn removes_legacy_api_env_var_when_structured_auth_exists() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "models": [{
            "nickname": "Custom",
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "LEGACY_KEY",
            "auth": { "type": "command", "command": ["op", "read", "key"] },
            "model": "custom",
            "context": 1000
        }],
        "fixJson": {
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "LEGACY_FIX_KEY",
            "auth": { "type": "env", "name": "FIX_KEY", "credential": "api-key" },
            "model": "fix-json"
        }
    }));

    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
    assert_eq!(
        sanitized["models"][0]["auth"],
        json!({ "type": "command", "command": ["op", "read", "key"] })
    );
    assert!(sanitized["fixJson"].get("apiEnvVar").is_none());
    assert_eq!(
        sanitized["fixJson"]["auth"],
        json!({ "type": "env", "name": "FIX_KEY", "credential": "api-key" })
    );
}

#[test]
fn removes_redundant_provider_env_vars_for_local_provider_typed_models() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "gemini": "CUSTOM_GEMINI_KEY" },
        "models": [
            {
                "nickname": "Local Anthropic",
                "type": "anthropic",
                "baseUrl": "http://127.0.0.1:8080",
                "apiEnvVar": "ANTHROPIC_API_KEY",
                "model": "claude-sonnet-5",
                "context": 200_000
            },
            {
                "nickname": "Local Gemini override",
                "type": "gemini",
                "baseUrl": "http://127.0.0.1:8080/v1beta",
                "apiEnvVar": "CUSTOM_GEMINI_KEY",
                "model": "gemini-3.5-flash",
                "context": 1_000_000
            },
            {
                "nickname": "Local OpenAI custom",
                "type": "openai-responses",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "apiEnvVar": "CUSTOM_OPENAI_KEY",
                "model": "gpt-5.4-mini",
                "context": 400_000
            }
        ]
    }));

    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
    assert!(sanitized["models"][1].get("apiEnvVar").is_none());
    assert_eq!(sanitized["models"][2]["apiEnvVar"], "CUSTOM_OPENAI_KEY");
}
