use octofriend_config::schema::validate_config;
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
        "compaction": { "autoThresholdPercent": 75, "compactOldestPercent": 50 },
        "showShellOutput": true,
        "showProviderMetrics": true,
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
    assert_eq!(validated["compaction"]["autoThresholdPercent"], 75);
    assert_eq!(validated["compaction"]["compactOldestPercent"], 50);
    assert_eq!(validated["showShellOutput"], true);
    assert_eq!(validated["showProviderMetrics"], true);
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
fn rejects_invalid_compaction_thresholds() {
    for key in ["autoThresholdPercent", "compactOldestPercent"] {
        for threshold in [json!(0), json!(101), json!(1.5), json!("75")] {
            assert!(
                validate_config(json!({
                    "yourName": "Ada",
                    "models": [],
                    "compaction": { (key): threshold }
                }))
                .is_err()
            );
        }
    }
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

#[test]
fn accepts_gemini_oauth_command_auth_with_quota_project() {
    let config = json!({
        "yourName": "Ada",
        "models": [{
            "type": "gemini",
            "nickname": "Gemini OAuth",
            "baseUrl": "https://generativelanguage.googleapis.com/v1beta",
            "model": "gemini-3.5-pro",
            "context": 1_000_000,
            "auth": {
                "type": "command",
                "command": ["gcloud", "auth", "application-default", "print-access-token"],
                "credential": "gemini-oauth",
                "project": "example-project"
            }
        }]
    });
    let validated = validate_config(config).expect("Gemini OAuth command auth should validate");
    assert_eq!(validated["models"][0]["auth"]["credential"], "gemini-oauth");
    assert_eq!(validated["models"][0]["auth"]["project"], "example-project");
}
