use octofwen_agent::rendering_model::{
    ToolRenderDetail, ToolRenderKind, build_tool_call_render_model,
};

#[test]
fn tool_render_model_describes_shell_command_and_timeout() {
    let model = build_tool_call_render_model(
        "shell",
        serde_json::json!({ "cmd": "cargo test", "timeout": 120000 }),
    );

    assert_eq!(model.kind, ToolRenderKind::Shell);
    assert_eq!(model.title, "shell");
    assert_eq!(model.subject.as_deref(), Some("cargo test"));
    assert_eq!(
        model.details,
        vec![ToolRenderDetail {
            label: "timeout".into(),
            value: "120000".into(),
        }]
    );
}

#[test]
fn tool_render_model_describes_file_creation_with_embedded_file_preview() {
    let model = build_tool_call_render_model(
        "create",
        serde_json::json!({ "filePath": "src/main.rs", "content": "fn main() {}" }),
    );

    assert_eq!(model.kind, ToolRenderKind::CreateFile);
    assert_eq!(model.title, "Octo wants to create");
    assert_eq!(model.subject.as_deref(), Some("src/main.rs"));
    let file = model
        .file_preview
        .expect("create should include file preview");
    assert_eq!(file.file_path, "src/main.rs");
    assert_eq!(file.lines[0].code, "fn main() {}");
}

#[test]
fn tool_render_model_describes_edit_with_embedded_diff_preview() {
    let model = build_tool_call_render_model(
        "edit",
        serde_json::json!({
            "filePath": "src/lib.ts",
            "search": "old",
            "replace": "new",
            "originalFileContents": "before\nold\nafter"
        }),
    );

    assert_eq!(model.kind, ToolRenderKind::EditFile);
    assert_eq!(model.title, "Edit");
    assert_eq!(model.subject.as_deref(), Some("src/lib.ts"));
    let diff = model
        .diff_preview
        .expect("edit should include diff preview");
    assert_eq!(diff.file_path, "src/lib.ts");
    assert_eq!(diff.start_line, 2);
    assert_eq!(diff.hunks[0].old.code, "old");
    assert_eq!(diff.hunks[0].new.code, "new");
}

#[test]
fn tool_render_model_describes_mcp_tool_and_serializes_arguments() {
    let model = build_tool_call_render_model(
        "mcp",
        serde_json::json!({
            "server": "filesystem",
            "tool": "read_file",
            "arguments": { "path": "README.md" }
        }),
    );

    assert_eq!(model.kind, ToolRenderKind::ModelContext);
    assert_eq!(model.title, "mcp");
    assert_eq!(
        model.subject.as_deref(),
        Some("Server: filesystem, Tool: read_file")
    );
    assert_eq!(
        model.details,
        vec![ToolRenderDetail {
            label: "Arguments".into(),
            value: "{\"path\":\"README.md\"}".into(),
        }]
    );
}

#[test]
fn tool_render_model_keeps_unknown_tools_structured() {
    let model = build_tool_call_render_model("custom", serde_json::json!({ "x": true }));

    assert_eq!(model.kind, ToolRenderKind::Unknown);
    assert_eq!(model.title, "custom");
    assert_eq!(model.subject, None);
    assert!(model.details.is_empty());
}

#[test]
fn tool_render_model_serializes_nested_previews_for_bridge_events() {
    let model = build_tool_call_render_model(
        "create",
        serde_json::json!({ "filePath": "src/main.rs", "content": "fn main() {}" }),
    );

    let value = serde_json::to_value(model).expect("tool render model should serialize");

    assert_eq!(value["kind"], "createFile");
    assert_eq!(value["title"], "Octo wants to create");
    assert_eq!(value["subject"], "src/main.rs");
    assert_eq!(value["filePreview"]["filePath"], "src/main.rs");
    assert!(value.get("diffPreview").is_none());
}
