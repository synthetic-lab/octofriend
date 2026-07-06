use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCallOutputRequest {
    pub items: Vec<ToolCallOutputItem>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ToolCallOutputItem {
    Parsed(ToolCallOutputParsed),
    Malformed {
        tool_call_id: String,
        name: String,
        arguments: Value,
        error: String,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCallOutputParsed {
    pub tool_call_id: String,
    pub name: String,
    pub original: Value,
    pub parsed: Value,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCallOutputResult {
    pub tool_calls: Vec<Value>,
}

pub fn build_tool_call_output(request: &ToolCallOutputRequest) -> ToolCallOutputResult {
    ToolCallOutputResult {
        tool_calls: request.items.iter().map(tool_call_output_json).collect(),
    }
}

fn tool_call_output_json(item: &ToolCallOutputItem) -> Value {
    match item {
        ToolCallOutputItem::Parsed(parsed) => json!({
            "type": "tool-call",
            "name": parsed.name,
            "toolCallId": parsed.tool_call_id,
            "original": parsed.original,
            "parsed": parsed.parsed,
        }),
        ToolCallOutputItem::Malformed {
            tool_call_id,
            name,
            arguments,
            error,
        } => json!({
            "type": "malformed-tool-request",
            "error": error,
            "toolCallId": tool_call_id,
            "call": {
                "original": {
                    "name": name,
                    "arguments": arguments,
                },
            },
        }),
    }
}
