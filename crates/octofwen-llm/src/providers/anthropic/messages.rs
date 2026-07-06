use crate::providers::{
    ProviderHttpRequest,
    stream::{ProviderStreamEvent, ProviderTokenKind, ProviderToolDelta},
};
use serde_json::{Map, Value, json};

pub const ANTHROPIC_API_VERSION: &str = "2023-06-01";

#[derive(Clone, Debug, PartialEq)]
pub struct AnthropicMessagesHttpRequestParams {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub system: String,
    pub messages: Value,
    pub tools: Option<Value>,
    pub max_tokens: u64,
    pub thinking: Option<Value>,
    pub output_config: Option<Value>,
}

pub fn anthropic_messages_http_request(
    request: &AnthropicMessagesHttpRequestParams,
) -> ProviderHttpRequest {
    ProviderHttpRequest {
        method: "POST".into(),
        url: format!("{}/v1/messages", request.base_url),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            ("x-api-key".into(), request.api_key.clone()),
            ("anthropic-version".into(), ANTHROPIC_API_VERSION.into()),
        ],
        body: anthropic_messages_body(
            &request.model,
            &request.system,
            &request.messages,
            request.tools.as_ref(),
            request.max_tokens,
            request.thinking.as_ref(),
            request.output_config.as_ref(),
        ),
    }
}

pub(crate) fn anthropic_messages_body(
    model: &str,
    system: &str,
    messages: &Value,
    tools: Option<&Value>,
    max_tokens: u64,
    thinking: Option<&Value>,
    output_config: Option<&Value>,
) -> Value {
    let mut body = Map::new();
    body.insert("max_tokens".into(), Value::Number(max_tokens.into()));
    body.insert("messages".into(), messages.clone());
    body.insert("model".into(), Value::String(model.into()));
    body.insert("stream".into(), Value::Bool(true));
    body.insert("system".into(), Value::String(system.into()));
    if let Some(thinking) = thinking {
        body.insert("thinking".into(), thinking.clone());
    }
    if let Some(output_config) = output_config {
        body.insert("output_config".into(), output_config.clone());
    }
    body.insert(
        "tool_choice".into(),
        json!({
            "disable_parallel_tool_use": false,
            "type": "auto",
        }),
    );
    if let Some(tools) = tools {
        body.insert("tools".into(), tools.clone());
    }
    Value::Object(body)
}

pub fn anthropic_messages_stream_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    match chunk.get("type").and_then(Value::as_str) {
        Some("content_block_delta") => content_block_delta_events(chunk),
        Some("content_block_start") => content_block_start_events(chunk),
        Some("message_delta") => message_delta_events(chunk),
        Some("message_start") => message_start_events(chunk),
        _ => Vec::new(),
    }
}

fn content_block_delta_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    let Some(delta) = chunk.get("delta") else {
        return Vec::new();
    };
    let index = chunk.get("index").and_then(Value::as_u64).unwrap_or(0);
    match delta.get("type").and_then(Value::as_str) {
        Some("text_delta") => token_event(delta, "text", ProviderTokenKind::Content),
        Some("thinking_delta") => {
            let Some(thinking) = non_empty_str(delta.get("thinking")) else {
                return Vec::new();
            };
            vec![
                ProviderStreamEvent::Token {
                    kind: ProviderTokenKind::Reasoning,
                    text: thinking.into(),
                },
                ProviderStreamEvent::AnthropicThinkingDelta {
                    index,
                    thinking: Some(thinking.into()),
                    signature: None,
                },
            ]
        }
        Some("signature_delta") => {
            let Some(signature) = non_empty_str(delta.get("signature")) else {
                return Vec::new();
            };
            vec![ProviderStreamEvent::AnthropicThinkingDelta {
                index,
                thinking: None,
                signature: Some(signature.into()),
            }]
        }
        Some("input_json_delta") => {
            let Some(partial_json) = non_empty_str(delta.get("partial_json")) else {
                return Vec::new();
            };
            vec![
                ProviderStreamEvent::Token {
                    kind: ProviderTokenKind::Tool,
                    text: partial_json.into(),
                },
                ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                    index,
                    id: None,
                    name: None,
                    arguments: Some(partial_json.into()),
                }),
            ]
        }
        _ => Vec::new(),
    }
}

fn content_block_start_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    let Some(content_block) = chunk.get("content_block") else {
        return Vec::new();
    };
    if content_block.get("type").and_then(Value::as_str) == Some("redacted_thinking") {
        let Some(data) = non_empty_str(content_block.get("data")) else {
            return Vec::new();
        };
        return vec![ProviderStreamEvent::AnthropicRedactedThinking { data: data.into() }];
    }
    if content_block.get("type").and_then(Value::as_str) != Some("tool_use") {
        return Vec::new();
    }
    let Some(name) = non_empty_str(content_block.get("name")) else {
        return Vec::new();
    };
    vec![
        ProviderStreamEvent::Token {
            kind: ProviderTokenKind::Tool,
            text: name.into(),
        },
        ProviderStreamEvent::ToolDelta(ProviderToolDelta {
            index: chunk.get("index").and_then(Value::as_u64).unwrap_or(0),
            id: non_empty_str(content_block.get("id")).map(str::to_string),
            name: Some(name.into()),
            arguments: None,
        }),
    ]
}

fn message_delta_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    let Some(usage) = chunk.get("usage") else {
        return Vec::new();
    };
    vec![ProviderStreamEvent::Usage {
        input: usage
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cached_input: usage
            .get("cache_read_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        output: usage
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        reasoning_output: 0,
    }]
}

fn message_start_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    let Some(usage) = chunk
        .get("message")
        .and_then(|message| message.get("usage"))
    else {
        return Vec::new();
    };
    vec![ProviderStreamEvent::Usage {
        input: usage
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cached_input: usage
            .get("cache_read_input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        output: usage
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        reasoning_output: 0,
    }]
}

fn token_event(value: &Value, field: &str, kind: ProviderTokenKind) -> Vec<ProviderStreamEvent> {
    non_empty_str(value.get(field))
        .map(|text| {
            vec![ProviderStreamEvent::Token {
                kind,
                text: text.into(),
            }]
        })
        .unwrap_or_default()
}

fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
