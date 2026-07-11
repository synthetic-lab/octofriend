use octofriend_models::compiler::{
    ToolCallPreparseInput, ToolCallPreparseResult, preparse_tool_call,
};
use serde_json::json;

#[test]
fn preparses_known_tool_json_arguments() {
    assert_eq!(
        preparse_tool_call(&ToolCallPreparseInput {
            tool_call_id: "call-1".into(),
            tool_name: "search".into(),
            args: json!("{\"query\":\" needle \"}"),
            available_tool_names: vec!["search".into()],
            autofixed_args: None,
        }),
        ToolCallPreparseResult::Ready {
            tool_call_id: "call-1".into(),
            tool_name: "search".into(),
            args: json!({ "query": " needle " }),
        }
    );
}

#[test]
fn preparses_empty_and_double_encoded_arguments() {
    assert_eq!(
        preparse_tool_call(&ToolCallPreparseInput {
            tool_call_id: "call-empty".into(),
            tool_name: "empty".into(),
            args: json!(""),
            available_tool_names: vec!["empty".into()],
            autofixed_args: None,
        }),
        ToolCallPreparseResult::Ready {
            tool_call_id: "call-empty".into(),
            tool_name: "empty".into(),
            args: json!({}),
        }
    );

    assert_eq!(
        preparse_tool_call(&ToolCallPreparseInput {
            tool_call_id: "call-double".into(),
            tool_name: "search".into(),
            args: json!(serde_json::to_string(&json!({ "query": "needle" })).unwrap()),
            available_tool_names: vec!["search".into()],
            autofixed_args: None,
        }),
        ToolCallPreparseResult::Ready {
            tool_call_id: "call-double".into(),
            tool_name: "search".into(),
            args: json!({ "query": "needle" }),
        }
    );
}

#[test]
fn reports_unknown_tools_before_json_parsing() {
    assert_eq!(
        preparse_tool_call(&ToolCallPreparseInput {
            tool_call_id: "call-1".into(),
            tool_name: "missing".into(),
            args: json!("{not json"),
            available_tool_names: vec!["search".into()],
            autofixed_args: None,
        }),
        ToolCallPreparseResult::Error {
            message: "Unknown tool missing. The only valid tool names are:\n\n- search\n\nPlease try calling a valid tool.".into(),
        }
    );
}

#[test]
fn requests_autofix_for_invalid_json_and_accepts_fixed_arguments() {
    assert_eq!(
        preparse_tool_call(&ToolCallPreparseInput {
            tool_call_id: "call-1".into(),
            tool_name: "search".into(),
            args: json!("{query:"),
            available_tool_names: vec!["search".into()],
            autofixed_args: None,
        }),
        ToolCallPreparseResult::NeedsAutofix {
            bad_json: "{query:".into(),
            message: "Syntax error: invalid JSON in tool call arguments".into(),
        }
    );

    assert_eq!(
        preparse_tool_call(&ToolCallPreparseInput {
            tool_call_id: "call-1".into(),
            tool_name: "search".into(),
            args: json!("{query:"),
            available_tool_names: vec!["search".into()],
            autofixed_args: Some(json!({ "query": "fixed" })),
        }),
        ToolCallPreparseResult::Ready {
            tool_call_id: "call-1".into(),
            tool_name: "search".into(),
            args: json!({ "query": "fixed" }),
        }
    );
}
