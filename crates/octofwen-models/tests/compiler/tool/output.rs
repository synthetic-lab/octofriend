use octofwen_models::compiler::{
    ToolCallOutputItem, ToolCallOutputParsed, ToolCallOutputRequest, ToolCallOutputResult,
    build_tool_call_output,
};
use serde_json::json;

#[test]
fn builds_assistant_tool_call_output_items() {
    assert_eq!(
        build_tool_call_output(&ToolCallOutputRequest {
            items: vec![
                ToolCallOutputItem::Parsed(ToolCallOutputParsed {
                    tool_call_id: "call-1".into(),
                    name: "search".into(),
                    original: json!({ "query": " needle " }),
                    parsed: json!({ "normalizedQuery": "needle" }),
                }),
                ToolCallOutputItem::Malformed {
                    tool_call_id: "call-2".into(),
                    name: "missing".into(),
                    arguments: json!("{bad"),
                    error: "Syntax error: invalid JSON in tool call arguments".into(),
                },
            ],
        }),
        ToolCallOutputResult {
            tool_calls: vec![
                json!({
                    "type": "tool-call",
                    "name": "search",
                    "toolCallId": "call-1",
                    "original": { "query": " needle " },
                    "parsed": { "normalizedQuery": "needle" }
                }),
                json!({
                    "type": "malformed-tool-request",
                    "error": "Syntax error: invalid JSON in tool call arguments",
                    "toolCallId": "call-2",
                    "call": {
                        "original": {
                            "name": "missing",
                            "arguments": "{bad"
                        }
                    }
                }),
            ],
        }
    );
}
