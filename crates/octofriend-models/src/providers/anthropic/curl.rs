use crate::providers::anthropic::messages::{
    ANTHROPIC_API_VERSION, AnthropicMessagesBodyParams, anthropic_messages_body,
};
use crate::providers::value::sorted_json_value_string;
use serde_json::Value;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnthropicCurlRequest {
    pub base_url: String,
    pub model: String,
    pub system: String,
    pub messages: Value,
    pub tools: Option<Value>,
    pub max_tokens: u64,
    pub thinking: Option<Value>,
    pub output_config: Option<Value>,
}

pub fn anthropic_messages_curl(request: &AnthropicCurlRequest) -> String {
    let body = anthropic_messages_body(AnthropicMessagesBodyParams {
        model: &request.model,
        system: &request.system,
        messages: &request.messages,
        tools: request.tools.as_ref(),
        max_tokens: request.max_tokens,
        thinking: request.thinking.as_ref(),
        output_config: request.output_config.as_ref(),
    });

    format!(
        "curl -X POST \"{}/v1/messages\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"x-api-key: [REDACTED_API_KEY]\" \\\n  -H \"anthropic-version: {ANTHROPIC_API_VERSION}\" \\\n  -d @- <<'JSON'\n{}\nJSON",
        request.base_url,
        sorted_json_value_string(&body)
    )
}
