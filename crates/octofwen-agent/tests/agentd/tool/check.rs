use octofwen_agent::runtime::{AGENTD_TOOL_VALIDATE_METHOD, handle_agentd_json_rpc_line};
use serde_json::json;

#[test]
fn tool_validate_request_returns_tool_validation_result() {
    let root = unique_temp_dir("octofwen-agentd-validate");
    std::fs::create_dir_all(&root).expect("temp dir should be created");
    std::fs::write(root.join("edit.txt"), "before old after")
        .expect("fixture file should be written");

    let valid_line = json!({
        "jsonrpc": "2.0",
        "id": "tool-validate-valid",
        "method": AGENTD_TOOL_VALIDATE_METHOD,
        "params": {
            "toolName": "edit",
            "cwd": root,
            "parsed": { "filePath": "edit.txt", "search": "old", "replace": "new" }
        }
    })
    .to_string();
    let valid_response =
        handle_agentd_json_rpc_line(&valid_line).expect("valid request should produce response");
    let valid_value: serde_json::Value =
        serde_json::from_str(&valid_response).expect("valid response should be json");
    assert_eq!(valid_value["result"], json!({ "status": "valid" }));

    let invalid_line = json!({
        "jsonrpc": "2.0",
        "id": "tool-validate-invalid",
        "method": AGENTD_TOOL_VALIDATE_METHOD,
        "params": {
            "toolName": "edit",
            "cwd": root,
            "parsed": { "filePath": "edit.txt", "search": "absent", "replace": "new" }
        }
    })
    .to_string();
    let invalid_response = handle_agentd_json_rpc_line(&invalid_line)
        .expect("invalid request should produce response");
    let invalid_value: serde_json::Value =
        serde_json::from_str(&invalid_response).expect("invalid response should be json");
    assert_eq!(
        invalid_value["result"],
        json!({
            "status": "error",
            "message": "Could not find search string in file edit.txt: absent\nThis is likely an error in your formatting. The search string must EXACTLY match, including\nwhitespace and punctuation."
        })
    );

    std::fs::remove_dir_all(root).expect("temp dir should be removed");
}

fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("clock should be after epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{nanos}"))
}
