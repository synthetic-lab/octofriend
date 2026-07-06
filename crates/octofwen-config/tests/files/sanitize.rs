use octofwen_config::files::{CURRENT_CONFIG_VERSION, sanitize_config};
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
            "context": 200000
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
                "context": 200000
            },
            {
                "nickname": "Custom",
                "baseUrl": "https://custom.invalid/v1",
                "apiEnvVar": "CUSTOM_API_KEY",
                "model": "custom",
                "context": 1000
            }
        ]
    }));

    assert_eq!(sanitized["models"][0]["apiEnvVar"], "CUSTOM_OPENAI_KEY");
    assert_eq!(sanitized["models"][1]["apiEnvVar"], "CUSTOM_API_KEY");
}

#[test]
fn honors_default_api_key_overrides_when_sanitizing() {
    let sanitized = sanitize_config(json!({
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "openai": "CUSTOM_OPENAI_KEY" },
        "models": [{
            "nickname": "GPT-5 Mini",
            "baseUrl": "https://api.openai.com/v1",
            "apiEnvVar": "CUSTOM_OPENAI_KEY",
            "model": "gpt-5-mini",
            "context": 200000
        }]
    }));

    assert!(sanitized["models"][0].get("apiEnvVar").is_none());
}
