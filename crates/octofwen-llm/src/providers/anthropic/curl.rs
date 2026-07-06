use crate::providers::anthropic::messages::{ANTHROPIC_API_VERSION, anthropic_messages_body};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
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
    let body = anthropic_messages_body(
        &request.model,
        &request.system,
        &request.messages,
        request.tools.as_ref(),
        request.max_tokens,
        request.thinking.as_ref(),
        request.output_config.as_ref(),
    );

    format!(
        "curl -X POST \"{}/v1/messages\" \\\n  -H \"Content-Type: application/json\" \\\n  -H \"x-api-key: [REDACTED_API_KEY]\" \\\n  -H \"anthropic-version: {ANTHROPIC_API_VERSION}\" \\\n  -d @- <<'JSON'\n{}\nJSON",
        request.base_url,
        serde_json::to_string(&body).expect("serializing serde_json::Value cannot fail")
    )
}
