use crate::providers::stream::ProviderStreamTool;
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ToolParseInputProvider {
    OpenAiChatCompletions,
    OpenAiResponses,
    Anthropic,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolParseInputRequest {
    pub provider: ToolParseInputProvider,
    pub tools: Vec<ProviderStreamTool>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolParseInputItem {
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ToolParseInputResult {
    pub items: Vec<ToolParseInputItem>,
}

pub fn build_tool_parse_inputs(request: &ToolParseInputRequest) -> ToolParseInputResult {
    ToolParseInputResult {
        items: request
            .tools
            .iter()
            .map(|tool| tool_parse_input_item(request.provider, tool))
            .collect(),
    }
}

fn tool_parse_input_item(
    provider: ToolParseInputProvider,
    tool: &ProviderStreamTool,
) -> ToolParseInputItem {
    ToolParseInputItem {
        tool_call_id: tool_call_id(provider, tool),
        tool_name: tool.name.clone().unwrap_or_default(),
        args: Value::String(tool.arguments.clone().unwrap_or_default()),
    }
}

fn tool_call_id(provider: ToolParseInputProvider, tool: &ProviderStreamTool) -> String {
    match provider {
        ToolParseInputProvider::OpenAiChatCompletions => tool.id.clone().unwrap_or_default(),
        ToolParseInputProvider::OpenAiResponses | ToolParseInputProvider::Anthropic => {
            tool.id.clone().unwrap_or_else(|| tool.index.to_string())
        }
    }
}
