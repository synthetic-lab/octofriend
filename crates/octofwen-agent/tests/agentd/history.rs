use octofwen_agent::runtime::{
    AGENTD_CONVERSATION_HISTORY_APPEND_METHOD, AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
    AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD, handle_agentd_json_rpc_line,
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
        "octofwen-agentd-conversation-history-{}-{nonce}",
        std::process::id()
    ))
}

fn request(method: &str, id: &str, params: serde_json::Value) -> serde_json::Value {
    let line = json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    })
    .to_string();
    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    serde_json::from_str(&response).expect("response should be json")
}

#[test]
fn conversation_history_requests_use_storage() {
    let temp_dir = unique_temp_dir();
    fs::create_dir_all(&temp_dir).expect("temp dir should be created");
    let database_path = temp_dir.join("conversation.sqlite");

    let entries = [
        json!({ "kind": "notification", "payload": "heads up" }),
        json!({ "kind": "request-failed" }),
        json!({ "kind": "llm-ir", "payload": "{\"role\":\"user\",\"content\":\"hello\"}" }),
        json!({ "kind": "compaction-failed" }),
        json!({ "kind": "llm-ir", "payload": "{\"role\":\"assistant\",\"content\":\"hi\"}" }),
    ];

    for (index, entry) in entries.into_iter().enumerate() {
        let response = request(
            AGENTD_CONVERSATION_HISTORY_APPEND_METHOD,
            &format!("append-{index}"),
            json!({
                "databasePath": database_path,
                "entry": entry
            }),
        );
        assert_eq!(response["result"], json!({}));
    }

    let records = request(
        AGENTD_CONVERSATION_HISTORY_RECORDS_METHOD,
        "records",
        json!({ "databasePath": database_path }),
    );
    assert_eq!(
        records["result"],
        json!({
            "records": [
                { "id": 1, "kind": "notification", "payload": "heads up" },
                { "id": 2, "kind": "request-failed", "payload": null },
                { "id": 3, "kind": "llm-ir", "payload": "{\"role\":\"user\",\"content\":\"hello\"}" },
                { "id": 4, "kind": "compaction-failed", "payload": null },
                { "id": 5, "kind": "llm-ir", "payload": "{\"role\":\"assistant\",\"content\":\"hi\"}" }
            ]
        })
    );

    let llm_payloads = request(
        AGENTD_CONVERSATION_HISTORY_LLM_PAYLOADS_METHOD,
        "llm-payloads",
        json!({ "databasePath": database_path }),
    );
    assert_eq!(
        llm_payloads["result"],
        json!({
            "payloads": [
                "{\"role\":\"user\",\"content\":\"hello\"}",
                "{\"role\":\"assistant\",\"content\":\"hi\"}"
            ]
        })
    );

    fs::remove_dir_all(&temp_dir).expect("temp dir should be removed");
}
