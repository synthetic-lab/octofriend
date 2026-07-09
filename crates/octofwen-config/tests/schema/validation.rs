use octofwen_config::schema::validate_config;
use serde_json::json;

#[test]
fn validates_exact_config_shapes_and_preserves_values() {
    let validated = validate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [{
            "type": "openai-responses",
            "nickname": "GPT",
            "baseUrl": "https://api.openai.com/v1",
            "apiEnvVar": "OPENAI_API_KEY",
            "auth": {
                "type": "env",
                "name": "CODEX_ACCESS_TOKEN",
                "credential": "chatgpt-oauth"
            },
            "model": "gpt",
            "context": 32000,
            "reasoning": "xhigh",
            "thinkingBudgetTokens": 12000,
            "modalities": {
                "image": {
                    "enabled": true,
                    "maxSizeMB": 10,
                    "acceptedMimeTypes": ["image/png"]
                }
            }
        }],
        "diffApply": {
            "type": "openai-responses",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt"
        },
        "fixJson": {
            "type": "gemini",
            "baseUrl": "https://api.openai.com/v1",
            "auth": { "type": "command", "command": ["op", "read"] },
            "model": "gpt"
        },
        "vimEmulation": { "enabled": true },
        "search": {
            "url": "https://search.invalid",
            "apiEnvVar": "SEARCH_API_KEY"
        },
        "defaultApiKeyOverrides": { "openai": "CUSTOM_OPENAI_KEY" },
        "mcpServers": {
            "server": {
                "command": "node",
                "args": ["server.js"],
                "env": { "NODE_ENV": "test" }
            }
        },
        "lsp": {
            "typescript": {
                "command": ["tsserver"],
                "extensions": [".ts"],
                "rootCandidates": ["package.json"]
            },
            "rust": { "disabled": true }
        },
        "skills": { "paths": ["/skills"] },
        "notifications": {
            "notifyCommand": "say done",
            "notifyTimeoutMs": 1000,
            "alwaysNotify": false
        }
    }))
    .expect("config should validate");

    assert_eq!(validated["yourName"], "Ada");
    assert_eq!(
        validated["models"][0]["auth"]["credential"],
        "chatgpt-oauth"
    );
    assert_eq!(validated["models"][0]["reasoning"], "xhigh");
    assert_eq!(validated["models"][0]["thinkingBudgetTokens"], 12000);
    assert_eq!(validated["diffApply"]["type"], "openai-responses");
    assert_eq!(validated["fixJson"]["type"], "gemini");
    assert_eq!(validated["lsp"]["rust"], json!({ "disabled": true }));
}

#[test]
fn validates_notifications_without_custom_notify_command() {
    let validated = validate_config(json!({
        "yourName": "Ada",
        "models": [],
        "notifications": {
            "notifyTimeoutMs": 1000,
            "alwaysNotify": true
        }
    }))
    .expect("config should validate");

    assert_eq!(
        validated["notifications"],
        json!({
            "notifyTimeoutMs": 1000,
            "alwaysNotify": true
        })
    );
}

#[test]
fn rejects_invalid_env_auth_credential() {
    assert!(
        validate_config(json!({
            "yourName": "Ada",
            "models": [{
                "nickname": "GPT",
                "baseUrl": "https://api.openai.com/v1",
                "auth": {
                    "type": "env",
                    "name": "CODEX_ACCESS_TOKEN",
                    "credential": "oauth"
                },
                "model": "gpt",
                "context": 100
            }]
        }))
        .is_err()
    );
}

#[test]
fn rejects_unknown_keys_and_mixed_lsp_disabled_entries() {
    assert!(
        validate_config(json!({
            "yourName": "Ada",
            "models": [],
            "extra": true
        }))
        .is_err()
    );
    assert!(
        validate_config(json!({
            "yourName": "Ada",
            "models": [{
                "nickname": "GPT",
                "baseUrl": "https://api.openai.com/v1",
                "model": "gpt",
                "context": 100,
                "extra": true
            }]
        }))
        .is_err()
    );
    assert!(
        validate_config(json!({
            "yourName": "Ada",
            "models": [{
                "nickname": "GPT",
                "baseUrl": "https://api.openai.com/v1",
                "model": "gpt",
                "context": 100,
                "thinkingBudgetTokens": -1
            }]
        }))
        .is_err()
    );
    assert!(
        validate_config(json!({
            "yourName": "Ada",
            "models": [{
                "nickname": "GPT",
                "baseUrl": "https://api.openai.com/v1",
                "model": "gpt",
                "context": 100,
                "thinkingBudgetTokens": 1.5
            }]
        }))
        .is_err()
    );
}
