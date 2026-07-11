use octofriend_core::contracts::{
    ParsedToolArguments, ToolCallEnvelope, ToolDeclaration, ToolPermission, ToolPermissionMode,
    ToolResultEnvelope, ToolSchemaReference,
};
use octofriend_core::ids::ToolCallId;
use serde_json::json;

#[test]
fn declares_provider_independent_tool_contracts_with_inline_schema_and_permission() {
    let declaration = ToolDeclaration::new(
        "read_file",
        "Read a workspace file",
        ToolSchemaReference::inline(json!({
            "type": "object",
            "required": ["path"],
            "properties": {
                "path": { "type": "string" }
            }
        })),
    )
    .with_permission(ToolPermission::new(ToolPermissionMode::Ask).with_reason("reads user files"));

    assert_eq!(declaration.name, "read_file");
    assert_eq!(declaration.permission.mode, ToolPermissionMode::Ask);
    assert_eq!(
        declaration.permission.reason.as_deref(),
        Some("reads user files")
    );
}

#[test]
fn represents_schema_references_without_copying_inline_schema_text() {
    let declaration = ToolDeclaration::new(
        "apply_patch",
        "Apply a source patch",
        ToolSchemaReference::reference("octofriend://schemas/tools/apply-patch"),
    );

    assert_eq!(
        declaration.schema,
        ToolSchemaReference::Ref("octofriend://schemas/tools/apply-patch".into())
    );
}

#[test]
fn carries_original_and_parsed_tool_arguments_with_call_id() {
    let call = ToolCallEnvelope::new(
        ToolCallId("call-1".into()),
        "search",
        ParsedToolArguments::new(
            json!({ "query": "hello", "limit": "5" }),
            json!({ "query": "hello", "limit": 5 }),
        ),
    );

    assert_eq!(call.id, ToolCallId("call-1".into()));
    assert_eq!(call.name, "search");
    assert_eq!(call.arguments.original["limit"], "5");
    assert_eq!(call.arguments.parsed["limit"], 5);
}

#[test]
fn wraps_success_and_error_tool_results() {
    let ok = ToolResultEnvelope::ok(ToolCallId("call-1".into()), json!({ "content": "done" }));
    let error = ToolResultEnvelope::error(
        ToolCallId("call-2".into()),
        json!({ "message": "permission denied" }),
    );

    assert!(ok.ok);
    assert_eq!(ok.value["content"], "done");
    assert!(!error.ok);
    assert_eq!(error.value["message"], "permission denied");
}
