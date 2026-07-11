use octofriend_agent::permissions::{
    ToolCallPermissionPolicy, ToolCallPermissionRequest, ToolWhitelist,
};
use serde_json::json;

#[test]
fn computes_stable_whitelist_keys_for_builtin_tool_groups() {
    assert_eq!(
        ToolCallPermissionRequest::new("read", json!({})).whitelist_key(),
        "read:*"
    );
    assert_eq!(
        ToolCallPermissionRequest::new("list", json!({})).whitelist_key(),
        "read:*"
    );
    assert_eq!(
        ToolCallPermissionRequest::new("edit", json!({})).whitelist_key(),
        "edits:*"
    );
    assert_eq!(
        ToolCallPermissionRequest::new("create", json!({})).whitelist_key(),
        "edits:*"
    );
    assert_eq!(
        ToolCallPermissionRequest::new("rewrite", json!({})).whitelist_key(),
        "edits:*"
    );
    assert_eq!(
        ToolCallPermissionRequest::new("shell", json!({})).whitelist_key(),
        "shell:*"
    );
}

#[test]
fn computes_server_scoped_mcp_whitelist_keys() {
    assert_eq!(
        ToolCallPermissionRequest::new(
            "mcp",
            json!({ "server": "filesystem", "tool": "read_file" })
        )
        .whitelist_key(),
        "mcp:filesystem:read_file"
    );
}

#[test]
fn whitelist_adds_keys_idempotently_and_checks_membership() {
    let mut whitelist = ToolWhitelist::new();

    assert!(!whitelist.is_whitelisted("shell:*"));
    whitelist.add("shell:*");
    whitelist.add("shell:*");

    assert!(whitelist.is_whitelisted("shell:*"));
    assert_eq!(whitelist.keys(), vec!["shell:*".to_string()]);
}

#[test]
fn computes_confirmation_policy_for_builtin_tool_groups() {
    assert_eq!(
        ToolCallPermissionRequest::new("read", json!({})).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "read:*".to_string(),
            skip_confirmation: true,
            always_request_permission: false,
        }
    );
    assert_eq!(
        ToolCallPermissionRequest::new("shell", json!({})).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "shell:*".to_string(),
            skip_confirmation: false,
            always_request_permission: true,
        }
    );
    assert_eq!(
        ToolCallPermissionRequest::new("edit", json!({})).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "edits:*".to_string(),
            skip_confirmation: false,
            always_request_permission: false,
        }
    );
}
