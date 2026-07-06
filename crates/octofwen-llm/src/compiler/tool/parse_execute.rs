use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq)]
pub struct ToolParseExecutionRequest {
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
    pub input: ToolParseExecutionInput,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ToolParseExecutionInput {
    Parsed { original: Value, parsed: Value },
    ToolError { message: String },
    SchemaError { error: String, expected: String },
}

#[derive(Clone, Debug, PartialEq)]
pub enum ToolParseExecutionResult {
    Success { tool: Value },
    Error { message: String },
}

pub fn build_tool_parse_execution_result(
    request: &ToolParseExecutionRequest,
) -> ToolParseExecutionResult {
    match &request.input {
        ToolParseExecutionInput::Parsed { original, parsed } => ToolParseExecutionResult::Success {
            tool: json!({
                "type": "tool-call",
                "name": request.tool_name,
                "toolCallId": request.tool_call_id,
                "original": original,
                "parsed": parsed,
            }),
        },
        ToolParseExecutionInput::ToolError { message } => ToolParseExecutionResult::Error {
            message: message.clone(),
        },
        ToolParseExecutionInput::SchemaError { error, expected } => {
            ToolParseExecutionResult::Error {
                message: schema_error_message(error, &request.args, expected),
            }
        }
    }
}

fn schema_error_message(error: &str, args: &Value, expected: &str) -> String {
    let args_json = serde_json::to_string(args).unwrap_or_else(|_| Value::Null.to_string());
    format!(
        "Failed to parse tool call: {error}. Make sure your arguments are valid and match the expected format.\n\nYour arguments were:\n{args_json}\n\nExpected:\n{expected}"
    )
}
