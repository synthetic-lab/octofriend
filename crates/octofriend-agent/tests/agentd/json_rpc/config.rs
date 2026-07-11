#[cfg(not(windows))]
use octofriend_agent::runtime::AGENTD_CONFIG_RUN_NOTIFY_METHOD;
use octofriend_agent::runtime::{
    AGENTD_CONFIG_AUTOFIX_KEYS_METHOD, AGENTD_CONFIG_DEFAULT_PATHS_METHOD,
    AGENTD_CONFIG_MIGRATE_METHOD, AGENTD_CONFIG_SANITIZE_METHOD, AGENTD_CONFIG_WRITE_KEY_METHOD,
    handle_agentd_json_rpc_line,
};
use octofriend_config::files::CURRENT_CONFIG_VERSION;
use serde_json::json;

mod auth;
mod env_merge;
mod select;

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
fn config_write_key_rejects_empty_api_keys() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "config-write-key-empty",
        "method": AGENTD_CONFIG_WRITE_KEY_METHOD,
        "params": {
            "baseUrl": "https://api.example.test/v1",
            "apiKey": "
     "
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "config-write-key-empty");
    assert_eq!(value["error"]["code"], -32602);
    assert_eq!(value["error"]["message"], "Could not write key file");
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
    assert_eq!(
        value["result"]["config"]["configVersion"],
        CURRENT_CONFIG_VERSION
    );
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
    assert_eq!(
        value["result"]["config"]["configVersion"],
        CURRENT_CONFIG_VERSION
    );
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
        "octofriend-notify-{}.txt",
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
