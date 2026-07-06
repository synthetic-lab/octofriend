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
            "auth": { "type": "env", "name": "OPENAI_API_KEY" },
            "model": "gpt",
            "context": 100,
            "reasoning": "medium",
            "modalities": {
                "image": {
                    "enabled": true,
                    "maxSizeMB": 10,
                    "acceptedMimeTypes": ["image/png"]
                }
            }
        }],
        "diffApply": {
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt"
        },
        "fixJson": {
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
    assert_eq!(validated["models"][0]["reasoning"], "medium");
    assert_eq!(validated["lsp"]["rust"], json!({ "disabled": true }));
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
            "models": [],
            "lsp": {
                "typescript": {
                    "disabled": true,
                    "command": ["tsserver"],
                    "extensions": [".ts"],
                    "rootCandidates": ["package.json"]
                }
            }
        }))
        .is_err()
    );
}
