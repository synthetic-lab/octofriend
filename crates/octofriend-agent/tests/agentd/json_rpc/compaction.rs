use octofriend_agent::runtime::{
    AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD, AGENTD_COMPACTION_DECISION_METHOD,
    AGENTD_COMPACTION_PREPARE_METHOD, handle_agentd_json_rpc_line,
};
use serde_json::json;

#[test]
fn compaction_decision_request_returns_agentd_threshold_decision() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "compaction-decision",
        "method": AGENTD_COMPACTION_DECISION_METHOD,
        "params": {
            "maxContextWindow": 100,
            "autoThresholdPercent": 95,
            "messages": [
                {
                    "role": "assistant",
                    "content": "old",
                    "usage": {
                        "input": { "cached": 0, "uncached": 100, "total": 100 },
                        "output": 100
                    }
                },
                {
                    "role": "assistant",
                    "content": "checkpoint",
                    "usage": {
                        "input": { "cached": 0, "uncached": 89, "total": 89 },
                        "output": 0
                    }
                },
                {
                    "role": "user",
                    "content": [{ "type": "text", "content": "hello" }]
                }
            ]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "compaction-decision");
    assert_eq!(
        value["result"],
        json!({
            "shouldCompact": false,
            "estimatedTokens": 91,
            "maxAllowedTokens": 95
        })
    );
}

#[test]
fn compaction_decision_counts_raw_checkpoint_content() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "compaction-raw-checkpoint",
        "method": AGENTD_COMPACTION_DECISION_METHOD,
        "params": {
            "maxContextWindow": 10,
            "messages": [{
                "role": "checkpoint",
                "content": [{ "type": "text", "content": "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz" }]
            }]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "compaction-raw-checkpoint");
    assert_eq!(value["result"]["shouldCompact"], true);
}

#[test]
fn compaction_prepare_request_returns_agentd_summary_prompt_messages() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "compaction-prepare",
        "method": AGENTD_COMPACTION_PREPARE_METHOD,
        "params": {
            "messages": [
                {
                    "role": "user",
                    "content": [{ "type": "text", "content": "work" }]
                }
            ]
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "compaction-prepare");
    let messages = value["result"]["messages"]
        .as_array()
        .expect("messages should be an array");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["role"], "user");
    assert_eq!(messages[0]["content"][0]["content"], "work");
    assert_eq!(messages[1]["role"], "user");
    let prompt = messages[1]["content"][0]["content"]
        .as_str()
        .expect("compaction prompt should be text");
    assert!(prompt.contains("Generate a summary"));
    assert!(prompt.contains("<summary>"));
}

#[test]
fn compaction_checkpoint_content_request_returns_agentd_checkpoint_content() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "compaction-checkpoint",
        "method": AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
        "params": {
            "output": {
                "role": "assistant",
                "content": "short summary",
                "usage": {
                    "input": { "cached": 0, "uncached": 0, "total": 0 },
                    "output": 0
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "compaction-checkpoint");
    assert_eq!(value["result"]["status"], "success");
    let content = value["result"]["content"]
        .as_array()
        .expect("content should be an array");
    let text = content
        .iter()
        .filter_map(|part| part["content"].as_str())
        .collect::<String>();
    assert!(text.contains("Conversation History Summary"));
    assert!(text.contains("short summary"));
    assert!(text.contains("Context Has Been Compacted"));
}

#[test]
fn compaction_checkpoint_content_request_reports_empty_summaries() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "compaction-checkpoint-empty",
        "method": AGENTD_COMPACTION_CHECKPOINT_CONTENT_METHOD,
        "params": {
            "output": {
                "role": "assistant",
                "content": "",
                "usage": {
                    "input": { "cached": 0, "uncached": 0, "total": 0 },
                    "output": 0
                }
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "compaction-checkpoint-empty");
    assert_eq!(
        value["result"],
        json!({
            "status": "empty",
            "message": "Compaction result was empty, continuing without compacting messages."
        })
    );
}
