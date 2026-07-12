use octofriend_agent::permissions::{
    ToolCallPermissionPolicy, ToolCallPermissionRequest, ToolWhitelist,
};
use serde_json::json;

fn request(name: &str, arguments: serde_json::Value) -> ToolCallPermissionRequest {
    ToolCallPermissionRequest::with_cwd(name, arguments, "/workspace/project")
}

#[test]
fn computes_directory_scoped_whitelist_keys_for_builtin_tool_groups() {
    assert_eq!(
        request("read", json!({ "filePath": "src/main.rs" })).whitelist_key(),
        "read:/workspace/project"
    );
    assert_eq!(
        request("list", json!({ "dirPath": "src" })).whitelist_key(),
        "read:/workspace/project"
    );
    assert_eq!(
        request("edit", json!({ "filePath": "src/main.rs" })).whitelist_key(),
        "edits:/workspace/project"
    );
    assert_eq!(
        request("create", json!({ "filePath": "../other/new.rs" })).whitelist_key(),
        "edits:/workspace/other"
    );
    assert_eq!(
        request("rewrite", json!({ "filePath": "/tmp/out.rs" })).whitelist_key(),
        "edits:/tmp"
    );
}

#[test]
fn normalizes_paths_without_accepting_prefix_siblings_as_in_project() {
    let sibling = request(
        "read",
        json!({ "filePath": "/workspace/project-other/secret" }),
    )
    .permission_policy();
    assert_eq!(sibling.whitelist_key, "read:/workspace/project-other");
    assert!(!sibling.skip_confirmation);

    let traversed = request("read", json!({ "filePath": "src/../../secret" })).permission_policy();
    assert_eq!(traversed.whitelist_key, "read:/workspace");
    assert!(!traversed.skip_confirmation);
}

#[test]
fn computes_server_scoped_mcp_whitelist_keys() {
    assert_eq!(
        request(
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
fn auto_allows_reads_only_inside_the_project_directory() {
    assert_eq!(
        request("read", json!({ "filePath": "README.md" })).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "read:/workspace/project".to_string(),
            skip_confirmation: true,
            always_request_permission: false,
        }
    );
    assert_eq!(
        request("read", json!({ "filePath": "/etc/passwd" })).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "read:/etc".to_string(),
            skip_confirmation: false,
            always_request_permission: false,
        }
    );
    assert_eq!(
        request("shell", json!({})).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "shell:*".to_string(),
            skip_confirmation: false,
            always_request_permission: true,
        }
    );
    assert_eq!(
        request("edit", json!({ "filePath": "src/main.rs" })).permission_policy(),
        ToolCallPermissionPolicy {
            whitelist_key: "edits:/workspace/project".to_string(),
            skip_confirmation: false,
            always_request_permission: false,
        }
    );
}
