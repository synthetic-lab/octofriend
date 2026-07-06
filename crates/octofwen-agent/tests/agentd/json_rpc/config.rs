#[cfg(not(windows))]
use octofwen_agent::agentd::AGENTD_CONFIG_RUN_NOTIFY_METHOD;
use octofwen_agent::agentd::{
    AGENTD_CONFIG_AUTOFIX_KEYS_METHOD, AGENTD_CONFIG_DEFAULT_PATHS_METHOD,
    AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD, AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
    AGENTD_CONFIG_MIGRATE_METHOD, AGENTD_CONFIG_SANITIZE_METHOD, AGENTD_CONFIG_SELECT_MODEL_METHOD,
    handle_agentd_json_rpc_line,
};
use serde_json::json;

#[cfg(windows)]
fn echo_command(text: &str) -> Vec<String> {
    vec!["cmd".into(), "/C".into(), "echo".into(), text.into()]
}

#[cfg(not(windows))]
fn echo_command(text: &str) -> Vec<String> {
    vec!["/bin/echo".into(), text.into()]
}

fn normalize_path_text(value: &serde_json::Value) -> String {
    value
        .as_str()
        .expect("path should be a string")
        .replace('\\', "/")
}

#[test]
fn config_migrate_request_uses_config_migrations() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-migrate-1",
        "method": AGENTD_CONFIG_MIGRATE_METHOD,
        "params": {
            "config": {
                "yourName": "Ada",
                "notifyFinishCommand": "say done",
                "models": [{
                    "nickname": "Kimi K2.5",
                    "baseUrl": "https://api.synthetic.new/v1",
                    "model": "hf:moonshotai/Kimi-K2.5",
                    "context": 262144
                }]
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-migrate-1");
    assert_eq!(value["result"]["config"]["configVersion"], 2);
    assert_eq!(
        value["result"]["config"]["notifications"]["notifyCommand"],
        "say done"
    );
    assert!(
        value["result"]["config"]
            .get("notifyFinishCommand")
            .is_none()
    );
    assert_eq!(
        value["result"]["config"]["models"][0]["modalities"]["image"]["acceptedMimeTypes"][2],
        "image/webp"
    );
}

#[test]
fn config_sanitize_request_uses_config_sanitizer() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-sanitize-1",
        "method": AGENTD_CONFIG_SANITIZE_METHOD,
        "params": {
            "config": {
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
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-sanitize-1");
    assert_eq!(value["result"]["config"]["configVersion"], 2);
    assert!(
        value["result"]["config"]["models"][0]
            .get("apiEnvVar")
            .is_none()
    );
    assert!(
        value["result"]["config"]["diffApply"]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_key_for_model_runs_agentd_command_auth() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-key-model-1",
        "method": octofwen_agent::agentd::AGENTD_CONFIG_KEY_FOR_MODEL_METHOD,
        "params": {
            "model": {
                "baseUrl": "https://api.example.invalid/v1",
                "auth": { "type": "command", "command": echo_command("model-key") }
            },
            "config": null
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-key-model-1");
    assert_eq!(
        value["result"]["result"],
        json!({ "ok": true, "key": "model-key" })
    );
}

#[test]
fn config_search_uses_agentd_search_auth() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-search-1",
        "method": octofwen_agent::agentd::AGENTD_CONFIG_SEARCH_METHOD,
        "params": {
            "config": {
                "search": {
                    "url": "https://search.example.invalid",
                    "auth": { "type": "command", "command": echo_command("search-key") }
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-search-1");
    assert_eq!(
        value["result"]["search"],
        json!({ "url": "https://search.example.invalid", "key": "search-key" })
    );
}

#[test]
fn config_merge_env_var_uses_provider_defaults() {
    let model = json!({
        "nickname": "GPT-5 Mini",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-5-mini",
        "context": 200000
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-env-1",
        "method": AGENTD_CONFIG_MERGE_ENV_VAR_METHOD,
        "params": {
            "config": { "yourName": "Ada", "models": [model.clone()] },
            "model": model,
            "apiEnvVar": "CUSTOM_OPENAI_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["openai"],
        "CUSTOM_OPENAI_KEY"
    );
    assert!(
        value["result"]["config"]["models"][0]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_merge_autofix_env_var_uses_provider_defaults() {
    let model = json!({
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-5-mini"
    });
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-merge-autofix-env-1",
        "method": AGENTD_CONFIG_MERGE_AUTOFIX_ENV_VAR_METHOD,
        "params": {
            "config": {
                "yourName": "Ada",
                "models": [],
                "fixJson": model.clone()
            },
            "key": "fixJson",
            "model": model,
            "apiEnvVar": "CUSTOM_OPENAI_KEY"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"]["config"]["defaultApiKeyOverrides"]["openai"],
        "CUSTOM_OPENAI_KEY"
    );
    assert!(
        value["result"]["config"]["fixJson"]
            .get("apiEnvVar")
            .is_none()
    );
}

#[test]
fn config_autofix_keys_are_agentd() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-autofix-keys-1",
        "method": AGENTD_CONFIG_AUTOFIX_KEYS_METHOD
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["result"]["keys"], json!(["diffApply", "fixJson"]));
}

#[test]
fn config_default_paths_are_agentd() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-default-paths-1",
        "method": AGENTD_CONFIG_DEFAULT_PATHS_METHOD
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    assert_eq!(
        normalize_path_text(&value["result"]["configDir"]),
        std::path::Path::new(&home)
            .join(".config")
            .join("octofriend")
            .display()
            .to_string()
            .replace('\\', "/")
    );
    assert_eq!(
        normalize_path_text(&value["result"]["configFile"]),
        std::path::Path::new(&home)
            .join(".config")
            .join("octofriend")
            .join("octofriend.json5")
            .display()
            .to_string()
            .replace('\\', "/")
    );
    assert_eq!(
        normalize_path_text(&value["result"]["keyFile"]),
        std::path::Path::new(&home)
            .join(".config")
            .join("octofriend")
            .join("keys.json5")
            .display()
            .to_string()
            .replace('\\', "/")
    );
}

#[cfg(not(windows))]
#[test]
fn config_run_notify_executes_command() {
    let output = std::env::temp_dir().join(format!(
        "octofwen-notify-{}.txt",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    ));
    #[cfg(windows)]
    let command = format!(r#"echo notified>"{}""#, output.display());
    #[cfg(not(windows))]
    let command = format!("printf notified > {}", output.display());
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-run-notify-1",
        "method": AGENTD_CONFIG_RUN_NOTIFY_METHOD,
        "params": {
            "config": {
                "notifications": { "notifyCommand": command }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["result"], json!({}));
    assert_eq!(
        std::fs::read_to_string(&output)
            .expect("notify output")
            .trim_end(),
        "notified"
    );
    std::fs::remove_file(output).expect("cleanup");
}

#[test]
fn config_select_model_uses_model_selection() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-select-model-1",
        "method": AGENTD_CONFIG_SELECT_MODEL_METHOD,
        "params": {
            "config": {
                "models": [
                    {
                        "nickname": "default",
                        "baseUrl": "https://api.openai.com/v1",
                        "model": "gpt-5-mini",
                        "context": 200000
                    },
                    {
                        "nickname": "chosen",
                        "baseUrl": "https://api.anthropic.com",
                        "model": "claude-opus-4-5",
                        "context": 200000
                    }
                ]
            },
            "modelOverride": "chosen"
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["result"]["model"]["nickname"], "chosen");

    let missing_line = json!({
        "jsonrpc": "2.0",
        "id": "config-select-model-2",
        "method": AGENTD_CONFIG_SELECT_MODEL_METHOD,
        "params": {
            "config": {
                "models": [
                    {
                        "nickname": "default",
                        "baseUrl": "https://api.openai.com/v1",
                        "model": "gpt-5-mini",
                        "context": 200000
                    }
                ]
            },
            "modelOverride": "missing"
        }
    })
    .to_string();
    let missing_response =
        handle_agentd_json_rpc_line(&missing_line).expect("request should produce response");
    let missing_value: serde_json::Value =
        serde_json::from_str(&missing_response).expect("response should be json");
    assert_eq!(missing_value["result"]["model"]["nickname"], "default");
}
