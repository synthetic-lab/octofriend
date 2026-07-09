use octofwen_agent::runtime::{
    AGENTD_INPUT_HISTORY_APPEND_METHOD, AGENTD_INPUT_HISTORY_LOAD_METHOD,
    handle_agentd_json_rpc_line,
};
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_temp_dir() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "octofwen-agentd-input-history-{}-{nonce}",
        std::process::id()
    ))
}

#[test]
fn input_history_load_and_append_requests_use_storage() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("input-history.sqlite");

    let load_empty_line = json!({
        "jsonrpc": "2.0",
        "id": "load-empty",
        "method": AGENTD_INPUT_HISTORY_LOAD_METHOD,
        "params": {
            "databasePath": database_path,
            "maxHistoryItems": 2
        }
    })
    .to_string();
    let load_empty_response =
        handle_agentd_json_rpc_line(&load_empty_line).expect("request should produce response");
    let load_empty_value: serde_json::Value =
        serde_json::from_str(&load_empty_response).expect("response should be json");
    assert_eq!(load_empty_value["result"], json!({ "history": [] }));

    for input in ["first", "second", "third"] {
        let append_line = json!({
            "jsonrpc": "2.0",
            "id": format!("append-{input}"),
            "method": AGENTD_INPUT_HISTORY_APPEND_METHOD,
            "params": {
                "databasePath": database_path,
                "maxHistoryItems": 2,
                "input": input
            }
        })
        .to_string();
        let append_response =
            handle_agentd_json_rpc_line(&append_line).expect("request should produce response");
        let append_value: serde_json::Value =
            serde_json::from_str(&append_response).expect("response should be json");
        assert!(append_value["result"]["history"].as_array().is_some());
    }

    let load_line = json!({
        "jsonrpc": "2.0",
        "id": "load-final",
        "method": AGENTD_INPUT_HISTORY_LOAD_METHOD,
        "params": {
            "databasePath": database_path,
            "maxHistoryItems": 2
        }
    })
    .to_string();
    let load_response =
        handle_agentd_json_rpc_line(&load_line).expect("request should produce response");
    let load_value: serde_json::Value =
        serde_json::from_str(&load_response).expect("response should be json");
    assert_eq!(
        load_value["result"],
        json!({ "history": ["second", "third"] })
    );
    fs::remove_dir_all(&temp_dir).expect("temp dir should be removed");
}
