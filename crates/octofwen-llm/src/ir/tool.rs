use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCall {
    pub tool_call_id: String,
    pub name: String,
    pub original: Value,
    pub parsed: Value,
}
