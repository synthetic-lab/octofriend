use octofwen_agent::runtime::{AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn synthetic_quota_fetch_rejects_missing_params_without_provider_http() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "synthetic-quota",
        "method": AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "synthetic-quota");
    assert_eq!(value["error"]["code"], -32602);
    assert_eq!(value["error"]["message"], "Invalid params");
}

#[test]
fn synthetic_quota_fetch_rejects_empty_api_key_without_provider_http() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "synthetic-quota",
        "method": AGENTD_SYNTHETIC_QUOTA_FETCH_METHOD,
        "params": { "apiKey": "" }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(value["id"], "synthetic-quota");
    assert_eq!(value["error"]["code"], -32602);
    assert_eq!(value["error"]["message"], "Invalid params");
}
