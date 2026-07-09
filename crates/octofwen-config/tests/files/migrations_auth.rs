use octofwen_config::files::{CURRENT_CONFIG_VERSION, migrate_config};
use serde_json::json;

#[test]
fn migrates_legacy_api_env_var_auth_fields() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "openai": "OPENAI_OVERRIDE_KEY" },
        "models": [
            {
                "nickname": "OpenAI default override",
                "baseUrl": "https://api.openai.com/v1",
                "apiEnvVar": "OPENAI_OVERRIDE_KEY",
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "OpenAI custom",
                "baseUrl": "https://api.openai.com/v1",
                "apiEnvVar": "CUSTOM_OPENAI_KEY",
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Existing auth",
                "baseUrl": "https://custom.invalid/v1",
                "apiEnvVar": "IGNORED_API_KEY",
                "auth": { "type": "command", "command": ["op", "read", "key"] },
                "model": "custom",
                "context": 200_000
            }
        ],
        "diffApply": {
            "baseUrl": "https://api.synthetic.new/v1",
            "apiEnvVar": "SYNTHETIC_API_KEY",
            "model": "hf:syntheticlab/diff-apply"
        },
        "fixJson": {
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "FIX_JSON_KEY",
            "model": "fix-json"
        },
        "autofixJson": {
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "LEGACY_FIX_JSON_KEY",
            "model": "legacy-fix-json"
        },
        "search": {
            "url": "https://search.invalid",
            "apiEnvVar": "SEARCH_KEY"
        }
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(migrated["models"][0].get("apiEnvVar").is_none());
    assert!(migrated["models"][0].get("auth").is_none());
    assert!(migrated["diffApply"].get("apiEnvVar").is_none());
    assert!(migrated["diffApply"].get("auth").is_none());
    assert_eq!(
        migrated["models"][1]["auth"],
        json!({ "type": "env", "name": "CUSTOM_OPENAI_KEY", "credential": "api-key" })
    );
    assert!(migrated["models"][1].get("apiEnvVar").is_none());
    assert_eq!(
        migrated["models"][2]["auth"],
        json!({ "type": "command", "command": ["op", "read", "key"] })
    );
    assert!(migrated["models"][2].get("apiEnvVar").is_none());
    assert_eq!(
        migrated["fixJson"]["auth"],
        json!({ "type": "env", "name": "FIX_JSON_KEY", "credential": "api-key" })
    );
    assert!(migrated["fixJson"].get("apiEnvVar").is_none());
    assert!(migrated.get("autofixJson").is_none());
    assert_eq!(
        migrated["search"]["auth"],
        json!({ "type": "env", "name": "SEARCH_KEY", "credential": "api-key" })
    );
    assert!(migrated["search"].get("apiEnvVar").is_none());
}

#[test]
fn migrates_legacy_env_auth_credentials() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [
            {
                "nickname": "OpenAI OAuth",
                "type": "openai-responses",
                "baseUrl": "https://api.openai.com/v1",
                "auth": { "type": "env", "name": "CODEX_ACCESS_TOKEN" },
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "OpenAI API key",
                "type": "openai-responses",
                "baseUrl": "https://api.openai.com/v1",
                "auth": { "type": "env", "name": "OPENAI_API_KEY" },
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Existing credential",
                "baseUrl": "https://api.openai.com/v1",
                "auth": {
                    "type": "env",
                    "name": " CODEX_ACCESS_TOKEN ",
                    "credential": "api-key"
                },
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Local OpenAI OAuth",
                "type": "openai-responses",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "auth": { "type": "env", "name": "CODEX_ACCESS_TOKEN" },
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Anthropic proxy with OpenAI-looking URL",
                "type": "anthropic",
                "baseUrl": "https://api.openai.com/v1",
                "auth": { "type": "env", "name": "CODEX_ACCESS_TOKEN" },
                "model": "claude-sonnet-5",
                "context": 200_000
            }
        ],
        "search": {
            "url": "https://search.invalid",
            "auth": { "type": "env", "name": " SEARCH_KEY " }
        }
    }));

    assert_eq!(
        migrated["models"][0]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
    assert_eq!(
        migrated["models"][1]["auth"],
        json!({ "type": "env", "name": "OPENAI_API_KEY", "credential": "api-key" })
    );
    assert_eq!(
        migrated["models"][2]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "api-key" })
    );
    assert_eq!(
        migrated["models"][3]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
    assert_eq!(
        migrated["models"][4]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "api-key" })
    );
    assert_eq!(
        migrated["search"]["auth"],
        json!({ "type": "env", "name": "SEARCH_KEY", "credential": "api-key" })
    );
}

#[test]
fn migrates_legacy_api_env_var_auth_fields_using_provider_type_for_local_base_urls() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
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

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(migrated["models"][0].get("apiEnvVar").is_none());
    assert!(migrated["models"][0].get("auth").is_none());
    assert!(migrated["models"][1].get("apiEnvVar").is_none());
    assert!(migrated["models"][1].get("auth").is_none());
    assert_eq!(
        migrated["models"][2]["auth"],
        json!({ "type": "env", "name": "CUSTOM_OPENAI_KEY", "credential": "api-key" })
    );
    assert!(migrated["models"][2].get("apiEnvVar").is_none());
}

#[test]
fn migrates_provider_type_from_legacy_env_var_for_local_proxy_models() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "anthropic": "ANTHROPIC_PROXY_KEY" },
        "models": [
            {
                "nickname": "Local OpenAI",
                "baseUrl": "http://127.0.0.1:8080/v1",
                "apiEnvVar": "OPENAI_API_KEY",
                "model": "gpt-5-mini",
                "context": 200_000
            },
            {
                "nickname": "Local Anthropic",
                "baseUrl": "http://127.0.0.1:8080",
                "apiEnvVar": "ANTHROPIC_PROXY_KEY",
                "model": "claude-sonnet-5",
                "context": 200_000
            },
            {
                "nickname": "Custom",
                "baseUrl": "http://127.0.0.1:11434/v1",
                "apiEnvVar": "CUSTOM_KEY",
                "model": "custom",
                "context": 128_000
            }
        ]
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(migrated["models"][0]["type"], "openai-responses");
    assert!(migrated["models"][0].get("apiEnvVar").is_none());
    assert!(migrated["models"][0].get("auth").is_none());
    assert_eq!(migrated["models"][1]["type"], "anthropic");
    assert!(migrated["models"][1].get("apiEnvVar").is_none());
    assert!(migrated["models"][1].get("auth").is_none());
    assert!(migrated["models"][2].get("type").is_none());
    assert_eq!(
        migrated["models"][2]["auth"],
        json!({ "type": "env", "name": "CUSTOM_KEY", "credential": "api-key" })
    );
}

#[test]
fn trims_legacy_api_env_var_auth_during_migration() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "anthropic": " ANTHROPIC_PROXY_KEY " },
        "models": [
            {
                "nickname": "Local Anthropic",
                "baseUrl": "http://127.0.0.1:8080",
                "apiEnvVar": " ANTHROPIC_PROXY_KEY ",
                "model": "claude-sonnet-5",
                "context": 200_000
            },
            {
                "nickname": "Custom",
                "baseUrl": "http://127.0.0.1:11434/v1",
                "apiEnvVar": " CUSTOM_KEY ",
                "model": "custom",
                "context": 128_000
            },
            {
                "nickname": "Blank",
                "baseUrl": "http://127.0.0.1:11434/v1",
                "apiEnvVar": " ",
                "model": "blank",
                "context": 128_000
            }
        ],
        "search": {
            "url": "https://search.invalid",
            "apiEnvVar": " SEARCH_KEY "
        }
    }));

    assert_eq!(migrated["models"][0]["type"], "anthropic");
    assert!(migrated["models"][0].get("auth").is_none());
    assert_eq!(
        migrated["models"][1]["auth"],
        json!({ "type": "env", "name": "CUSTOM_KEY", "credential": "api-key" })
    );
    assert!(migrated["models"][2].get("auth").is_none());
    assert_eq!(
        migrated["search"]["auth"],
        json!({ "type": "env", "name": "SEARCH_KEY", "credential": "api-key" })
    );
}

#[test]
fn drops_legacy_api_env_var_when_structured_auth_already_exists() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [{
            "nickname": "Existing auth",
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "IGNORED_API_KEY",
            "auth": { "type": "command", "command": ["op", "read", "key"] },
            "model": "custom",
            "context": 200_000
        }],
        "search": {
            "url": "https://search.invalid",
            "apiEnvVar": "IGNORED_SEARCH_KEY",
            "auth": { "type": "env", "name": "SEARCH_AUTH_KEY" }
        }
    }));

    assert_eq!(
        migrated["models"][0]["auth"],
        json!({ "type": "command", "command": ["op", "read", "key"] })
    );
    assert!(migrated["models"][0].get("apiEnvVar").is_none());
    assert_eq!(
        migrated["search"]["auth"],
        json!({ "type": "env", "name": "SEARCH_AUTH_KEY", "credential": "api-key" })
    );
    assert!(migrated["search"].get("apiEnvVar").is_none());
}

#[test]
fn migrates_legacy_notify_finish_command_when_only_version_six_migration_applies() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "notifyFinishCommand": "say late legacy done",
        "models": []
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert_eq!(
        migrated["notifications"]["notifyCommand"],
        "say late legacy done"
    );
    assert!(migrated.get("notifyFinishCommand").is_none());
}

#[test]
fn migrates_legacy_autofix_json_to_fix_json() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [],
        "autofixJson": {
            "baseUrl": "https://api.synthetic.new/v1",
            "apiEnvVar": "SYNTHETIC_API_KEY",
            "model": "hf:syntheticlab/fix-json"
        }
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(migrated.get("autofixJson").is_none());
    assert_eq!(
        migrated["fixJson"],
        json!({
            "baseUrl": "https://api.synthetic.new/v1",
            "model": "hf:syntheticlab/fix-json"
        })
    );
}

#[test]
fn migrates_legacy_autofix_json_auth_when_only_version_six_migration_applies() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "models": [],
        "autofixJson": {
            "baseUrl": "https://custom.invalid/v1",
            "apiEnvVar": "LEGACY_FIX_JSON_KEY",
            "model": "legacy-fix-json"
        }
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(migrated.get("autofixJson").is_none());
    assert!(migrated["fixJson"].get("apiEnvVar").is_none());
    assert_eq!(
        migrated["fixJson"],
        json!({
            "baseUrl": "https://custom.invalid/v1",
            "auth": { "type": "env", "name": "LEGACY_FIX_JSON_KEY", "credential": "api-key" },
            "model": "legacy-fix-json"
        })
    );
}

#[test]
fn migrates_legacy_autofix_json_default_env_for_local_proxy_without_explicit_auth() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "anthropic": "ANTHROPIC_PROXY_KEY" },
        "models": [],
        "autofixJson": {
            "baseUrl": "http://127.0.0.1:8080",
            "apiEnvVar": "ANTHROPIC_PROXY_KEY",
            "model": "legacy-fix-json"
        }
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(migrated.get("autofixJson").is_none());
    assert!(migrated["fixJson"].get("apiEnvVar").is_none());
    assert!(migrated["fixJson"].get("auth").is_none());
    assert_eq!(
        migrated["fixJson"],
        json!({
            "type": "anthropic",
            "baseUrl": "http://127.0.0.1:8080",
            "model": "legacy-fix-json"
        })
    );
}

#[test]
fn migrates_provider_type_for_legacy_autofix_models() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "defaultApiKeyOverrides": { "gemini": "GEMINI_PROXY_KEY" },
        "models": [],
        "diffApply": {
            "baseUrl": "http://127.0.0.1:8080/v1",
            "apiEnvVar": "OPENAI_API_KEY",
            "model": "diff-apply"
        },
        "fixJson": {
            "baseUrl": "http://127.0.0.1:8080/v1beta",
            "apiEnvVar": "GEMINI_PROXY_KEY",
            "model": "fix-json"
        }
    }));

    assert_eq!(migrated["diffApply"]["type"], "openai-responses");
    assert!(migrated["diffApply"].get("apiEnvVar").is_none());
    assert!(migrated["diffApply"].get("auth").is_none());
    assert_eq!(migrated["fixJson"]["type"], "gemini");
    assert!(migrated["fixJson"].get("apiEnvVar").is_none());
    assert!(migrated["fixJson"].get("auth").is_none());
}

#[test]
fn legacy_autofix_json_does_not_overwrite_existing_fix_json() {
    let migrated = migrate_config(json!({
        "configVersion": 5,
        "yourName": "Ada",
        "models": [],
        "fixJson": {
            "baseUrl": "https://api.synthetic.new/v1",
            "apiEnvVar": "PRIMARY_SYNTHETIC_KEY",
            "model": "hf:syntheticlab/fix-json"
        },
        "autofixJson": {
            "baseUrl": "https://legacy.invalid/v1",
            "apiEnvVar": "LEGACY_KEY",
            "model": "legacy-fix-json"
        }
    }));

    assert_eq!(migrated["configVersion"], CURRENT_CONFIG_VERSION);
    assert!(migrated.get("autofixJson").is_none());
    assert!(migrated["fixJson"].get("apiEnvVar").is_none());
    assert_eq!(
        migrated["fixJson"]["auth"],
        json!({ "type": "env", "name": "PRIMARY_SYNTHETIC_KEY", "credential": "api-key" })
    );
}
