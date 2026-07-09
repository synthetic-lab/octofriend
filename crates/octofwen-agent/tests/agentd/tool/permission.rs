use octofwen_agent::runtime::{AGENTD_TOOL_PERMISSION_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn tool_permission_request_returns_permission_policy() {
    let line = json!({
        "jsonrpc": "2.0",
        "id": "tool-permission-mcp",
        "method": AGENTD_TOOL_PERMISSION_METHOD,
        "params": {
            "toolName": "mcp",
            "parsed": {
                "server": "filesystem",
                "tool": "read_file"
            }
        }
    })
    .to_string();

    let response = handle_agentd_json_rpc_line(&line).expect("request should produce response");
    let value: serde_json::Value =
        serde_json::from_str(&response).expect("response should be json");

    assert_eq!(
        value["result"],
        json!({
            "whitelistKey": "mcp:filesystem:read_file",
            "skipConfirmation": false,
            "alwaysRequestPermission": false
        })
    );
}
