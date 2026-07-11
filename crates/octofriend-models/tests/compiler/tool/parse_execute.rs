use octofriend_models::compiler::{
    ToolParseExecutionInput, ToolParseExecutionRequest, ToolParseExecutionResult,
    build_tool_parse_execution_result,
};
use serde_json::json;

#[test]
fn parsed_tool_execution_returns_shaped_tool_call() {
    let result = build_tool_parse_execution_result(&ToolParseExecutionRequest {
        tool_call_id: "call-1".into(),
        tool_name: "search".into(),
        args: json!({ "query": " needle " }),
        input: ToolParseExecutionInput::Parsed {
            original: json!({ "query": " needle " }),
            parsed: json!({ "normalizedQuery": "needle" }),
        },
    });

    assert_eq!(
        result,
        ToolParseExecutionResult::Success {
            tool: json!({
                "type": "tool-call",
                "name": "search",
                "toolCallId": "call-1",
                "original": { "query": " needle " },
                "parsed": { "normalizedQuery": "needle" }
            })
        }
    );
}

#[test]
fn schema_error_returns_shaped_validation_message() {
    let result = build_tool_parse_execution_result(&ToolParseExecutionRequest {
        tool_call_id: "call-2".into(),
        tool_name: "search".into(),
        args: json!({ "query": 12 }),
        input: ToolParseExecutionInput::SchemaError {
            error: "Expected string".into(),
            expected: "{ query: string }".into(),
        },
    });

    assert_eq!(
        result,
        ToolParseExecutionResult::Error {
            message: "Failed to parse tool call: Expected string. Make sure your arguments are valid and match the expected format.\n\nYour arguments were:\n{\"query\":12}\n\nExpected:\n{ query: string }".into(),
        }
    );
}

#[test]
fn tool_parser_error_is_returned_without_schema_wrapping() {
    let result = build_tool_parse_execution_result(&ToolParseExecutionRequest {
        tool_call_id: "call-3".into(),
        tool_name: "search".into(),
        args: json!({ "query": "needle" }),
        input: ToolParseExecutionInput::ToolError {
            message: "tool rejected query".into(),
        },
    });

    assert_eq!(
        result,
        ToolParseExecutionResult::Error {
            message: "tool rejected query".into(),
        }
    );
}
