use octofriend_agent::runtime::{
    AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD, AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
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
        "octofriend-agentd-update-notifications-{}-{nonce}",
        std::process::id()
    ))
}

#[test]
fn update_notification_read_and_mark_requests_use_storage() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let updates_path = temp_dir.join("IN-APP-UPDATES.txt");
    let database_path = temp_dir.join("sqlite.db");
    fs::write(&updates_path, "First update\n").expect("updates fixture should be written");

    let read_line = json!({
        "jsonrpc": "2.0",
        "id": "read-first",
        "method": AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
        "params": {
            "updatesPath": updates_path,
            "databasePath": database_path
        }
    })
    .to_string();
    let read_response =
        handle_agentd_json_rpc_line(&read_line).expect("request should produce response");
    let read_value: serde_json::Value =
        serde_json::from_str(&read_response).expect("response should be json");
    assert_eq!(read_value["result"], json!({ "updates": "First update\n" }));

    let mark_line = json!({
        "jsonrpc": "2.0",
        "id": "mark",
        "method": AGENTD_UPDATE_NOTIFICATIONS_MARK_SEEN_METHOD,
        "params": {
            "updatesPath": updates_path,
            "databasePath": database_path
        }
    })
    .to_string();
    let mark_response =
        handle_agentd_json_rpc_line(&mark_line).expect("request should produce response");
    let mark_value: serde_json::Value =
        serde_json::from_str(&mark_response).expect("response should be json");
    assert_eq!(mark_value["result"], json!({}));

    let read_seen_line = json!({
        "jsonrpc": "2.0",
        "id": "read-seen",
        "method": AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
        "params": {
            "updatesPath": updates_path,
            "databasePath": database_path
        }
    })
    .to_string();
    let read_seen_response =
        handle_agentd_json_rpc_line(&read_seen_line).expect("request should produce response");
    let read_seen_value: serde_json::Value =
        serde_json::from_str(&read_seen_response).expect("response should be json");
    assert_eq!(read_seen_value["result"], json!({ "updates": null }));

    fs::write(&updates_path, "Second update\n").expect("updates fixture should be changed");
    let read_changed_line = json!({
        "jsonrpc": "2.0",
        "id": "read-changed",
        "method": AGENTD_UPDATE_NOTIFICATIONS_READ_METHOD,
        "params": {
            "updatesPath": updates_path,
            "databasePath": database_path
        }
    })
    .to_string();
    let read_changed_response =
        handle_agentd_json_rpc_line(&read_changed_line).expect("request should produce response");
    let read_changed_value: serde_json::Value =
        serde_json::from_str(&read_changed_response).expect("response should be json");
    assert_eq!(
        read_changed_value["result"],
        json!({ "updates": "Second update\n" })
    );

    fs::remove_dir_all(&temp_dir).expect("temp dir should be removed");
}
