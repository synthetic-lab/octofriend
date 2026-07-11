use octofriend_config::files::migrate_config;
use octofriend_config::schema::validate_config;
use serde_json::json;

#[test]
fn legacy_octofriend_config_migrates_and_validates() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [
            {
                "type": "openai-responses",
                "nickname": "OpenAI old env auth",
                "baseUrl": "https://api.openai.com/v1",
                "auth": { "type": "env", "name": "OPENAI_API_KEY" },
                "model": "gpt-5-mini",
                "context": 200_000,
                "reasoning": "high"
            },
            {
                "type": "anthropic",
                "nickname": "Anthropic old apiEnvVar",
                "baseUrl": "https://api.anthropic.com",
                "apiEnvVar": "ANTHROPIC_API_KEY",
                "model": "claude-sonnet-4-5",
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
            "auth": { "type": "command", "command": ["op", "read", "item"] },
            "model": "fix-json"
        },
        "search": {
            "url": "https://search.invalid",
            "auth": { "type": "env", "name": "SEARCH_API_KEY" }
        },
        "mcpServers": {
            "filesystem": { "command": "bunx", "args": ["@modelcontextprotocol/server-filesystem", "."] }
        },
        "lsp": false,
        "skills": { "paths": ["/tmp/skills"] },
        "notifications": {
            "notifyCommand": "say done",
            "notifyTimeoutMs": 1000,
            "alwaysNotify": true
        }
    }));

    let validated = validate_config(migrated).expect("legacy octofriend config should validate");

    assert_eq!(validated["models"][0]["auth"]["name"], "OPENAI_API_KEY");
    assert_eq!(validated["models"][0]["auth"]["credential"], "api-key");
    assert_eq!(validated["models"][1].get("apiEnvVar"), None);
    assert_eq!(validated["models"][1].get("auth"), None);
    assert_eq!(validated["diffApply"].get("apiEnvVar"), None);
    assert_eq!(validated["diffApply"].get("auth"), None);
    assert_eq!(validated["search"]["auth"]["credential"], "api-key");
}

#[test]
fn legacy_readme_local_llm_model_migrates_and_validates() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [{
            "nickname": "Local GPT",
            "baseUrl": "http://localhost:11434/v1",
            "apiEnvVar": "LOCAL_API_KEY",
            "model": "openai/gpt-oss-20b"
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy README local LLM config should validate after migration");

    assert_eq!(validated["models"][0]["context"], 128_000);
    assert_eq!(
        validated["models"][0]["auth"],
        json!({ "type": "env", "name": "LOCAL_API_KEY", "credential": "api-key" })
    );
    assert!(validated["models"][0].get("apiEnvVar").is_none());
}

#[test]
fn legacy_readme_anthropic_compatible_local_model_migrates_and_validates() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [{
            "nickname": "Local Claude",
            "baseUrl": "http://127.0.0.1:8080",
            "apiEnvVar": "ANTHROPIC_API_KEY",
            "model": "claude-sonnet-5"
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy Anthropic-compatible local config should validate after migration");

    assert_eq!(validated["models"][0]["type"], "anthropic");
    assert_eq!(validated["models"][0]["context"], 1_000_000);
    assert!(validated["models"][0].get("apiEnvVar").is_none());
    assert!(validated["models"][0].get("auth").is_none());
}

#[test]
fn legacy_octofriend_codex_model_migrates_to_openai_oauth() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [{
            "type": "codex",
            "nickname": "OpenAI Codex Subscription",
            "auth": { "type": "codex" },
            "model": "gpt-5.5",
            "context": 200 * 1024,
            "reasoning": "xhigh"
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy octofriend Codex subscription config should validate after migration");

    assert_eq!(validated["models"][0]["type"], "openai-responses");
    assert_eq!(
        validated["models"][0]["baseUrl"],
        "https://api.openai.com/v1"
    );
    assert_eq!(
        validated["models"][0]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
}

#[test]
fn legacy_octofriend_codex_base_url_migrates_to_openai_oauth() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [{
            "nickname": "OpenAI Codex Subscription",
            "baseUrl": " https://chatgpt.com/backend-api/codex/ ",
            "auth": { "type": "codex" },
            "model": "gpt-5.5",
            "context": 200 * 1024
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy octofriend Codex base URL config should validate after migration");

    assert_eq!(validated["models"][0]["type"], "openai-responses");
    assert_eq!(
        validated["models"][0]["baseUrl"],
        "https://api.openai.com/v1"
    );
    assert_eq!(
        validated["models"][0]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
}

#[test]
fn legacy_octofriend_codex_base_url_keeps_explicit_api_key_auth() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [{
            "nickname": "OpenAI API key",
            "baseUrl": "https://chatgpt.com/backend-api/codex",
            "auth": { "type": "env", "name": "OPENAI_API_KEY" },
            "model": "gpt-5.5",
            "context": 200 * 1024
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy Codex base URL with explicit API-key auth should validate after migration");

    assert_eq!(validated["models"][0]["type"], "openai-responses");
    assert_eq!(
        validated["models"][0]["baseUrl"],
        "https://api.openai.com/v1"
    );
    assert_eq!(
        validated["models"][0]["auth"],
        json!({ "type": "env", "name": "OPENAI_API_KEY", "credential": "api-key" })
    );
}

#[test]
fn legacy_octofriend_codex_env_token_auth_trims_and_migrates_to_openai_oauth() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [{
            "type": "codex",
            "nickname": "OpenAI Codex Subscription",
            "auth": { "type": "env", "name": " CODEX_ACCESS_TOKEN\n" },
            "model": "gpt-5.5",
            "context": 200 * 1024
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy octofriend env token auth should validate after migration");

    assert_eq!(validated["models"][0]["type"], "openai-responses");
    assert_eq!(
        validated["models"][0]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
}

#[test]
fn legacy_octofriend_openai_codex_env_token_auth_migrates_to_openai_oauth() {
    let migrated = migrate_config(json!({
        "configVersion": 2,
        "yourName": "Ada",
        "models": [{
            "type": "codex",
            "nickname": "OpenAI Codex Subscription",
            "auth": { "type": "env", "name": " OPENAI_CODEX_ACCESS_TOKEN\n" },
            "model": "gpt-5.5",
            "context": 200 * 1024
        }]
    }));

    let validated = validate_config(migrated)
        .expect("legacy octofriend OpenAI Codex env token auth should validate after migration");

    assert_eq!(validated["models"][0]["type"], "openai-responses");
    assert_eq!(
        validated["models"][0]["auth"],
        json!({ "type": "env", "name": "OPENAI_CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
}

#[test]
fn legacy_octofriend_codex_autofix_models_migrate_to_openai_oauth() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [],
        "diffApply": {
            "type": "codex",
            "auth": { "type": "codex" },
            "model": "gpt-5.5"
        },
        "autofixJson": {
            "type": "codex",
            "auth": { "type": "codex" },
            "model": "gpt-5.5"
        }
    }));

    let validated = validate_config(migrated)
        .expect("legacy octofriend Codex autofix models should validate after migration");

    assert_eq!(validated["diffApply"]["type"], "openai-responses");
    assert_eq!(
        validated["diffApply"]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
    assert_eq!(validated["fixJson"]["type"], "openai-responses");
    assert_eq!(
        validated["fixJson"]["auth"],
        json!({ "type": "env", "name": "CODEX_ACCESS_TOKEN", "credential": "chatgpt-oauth" })
    );
}

#[test]
fn legacy_octofriend_partial_default_config_migrates_and_validates() {
    let migrated = migrate_config(json!({
        "mcpServers": {
            "filesystem": {
                "command": "bunx",
                "args": ["@modelcontextprotocol/server-filesystem", "."]
            }
        }
    }));

    let validated = validate_config(migrated)
        .expect("legacy partial octofriend config should validate after migration");

    assert_eq!(validated["yourName"], "unknown");
    assert_eq!(validated["models"], json!([]));
    assert_eq!(validated["mcpServers"]["filesystem"]["command"], "bunx");
    assert_eq!(
        validated["mcpServers"]["filesystem"]["args"],
        json!(["@modelcontextprotocol/server-filesystem", "."])
    );
}

#[test]
fn legacy_non_object_config_migrates_to_required_defaults() {
    let migrated = migrate_config(json!(null));

    let validated = validate_config(migrated)
        .expect("legacy non-object config should validate after defaults are added");

    assert_eq!(validated["yourName"], "unknown");
    assert_eq!(validated["models"], json!([]));
}

#[test]
fn legacy_wrong_required_default_shapes_migrate_to_required_defaults() {
    let migrated = migrate_config(json!({
        "yourName": null,
        "models": null,
        "notifications": { "alwaysNotify": true }
    }));

    let validated = validate_config(migrated).expect(
        "legacy config with wrong required shapes should validate after defaults are added",
    );

    assert_eq!(validated["yourName"], "unknown");
    assert_eq!(validated["models"], json!([]));
    assert_eq!(validated["notifications"]["alwaysNotify"], true);
}

#[test]
fn legacy_octofriend_readme_search_api_env_var_migrates_and_validates() {
    let migrated = migrate_config(json!({
        "yourName": "Ada",
        "models": [],
        "search": {
            "url": "https://search.example.test",
            "apiEnvVar": " SOME_ENV_VAR_FOR_AUTH\n"
        }
    }));

    let validated = validate_config(migrated)
        .expect("legacy README search apiEnvVar config should validate after migration");

    assert_eq!(
        validated["search"]["auth"],
        json!({ "type": "env", "name": "SOME_ENV_VAR_FOR_AUTH", "credential": "api-key" })
    );
    assert!(validated["search"].get("apiEnvVar").is_none());
}
