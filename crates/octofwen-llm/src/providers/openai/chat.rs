use crate::providers::{
    ProviderHttpRequest,
    openai::curl::{openai_endpoint_url, redacted_openai_curl},
    stream::{ProviderStreamEvent, ProviderTokenKind, ProviderToolDelta},
};
use serde_json::{Map, Value, json};

#[derive(Clone, Debug, PartialEq)]
pub struct OpenAiChatCompletionsCurlRequest {
    pub base_url: String,
    pub model: String,
    pub messages: Value,
    pub tools: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OpenAiChatCompletionsHttpRequestParams {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub messages: Value,
    pub tools: Option<Value>,
}

pub fn openai_chat_completions_curl(request: &OpenAiChatCompletionsCurlRequest) -> String {
    redacted_openai_curl(
        &request.base_url,
        "chat/completions",
        &openai_chat_completions_body(&request.model, &request.messages, request.tools.as_ref()),
    )
}

pub fn openai_chat_completions_http_request(
    request: &OpenAiChatCompletionsHttpRequestParams,
) -> ProviderHttpRequest {
    ProviderHttpRequest {
        method: "POST".into(),
        url: openai_endpoint_url(&request.base_url, "chat/completions"),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            (
                "Authorization".into(),
                format!("Bearer {}", request.api_key),
            ),
        ],
        body: openai_chat_completions_body(
            &request.model,
            &request.messages,
            request.tools.as_ref(),
        ),
    }
}

fn openai_chat_completions_body(model: &str, messages: &Value, tools: Option<&Value>) -> Value {
    let mut body = Map::new();
    body.insert("messages".into(), messages.clone());
    body.insert("model".into(), Value::String(model.into()));
    body.insert("stream".into(), Value::Bool(true));
    body.insert(
        "stream_options".into(),
        json!({
            "include_usage": true,
        }),
    );
    if let Some(tools) = tools {
        body.insert("tools".into(), tools.clone());
    }
    Value::Object(body)
}

pub fn openai_chat_completions_stream_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    let mut events = Vec::new();
    let delta = chunk
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"));

    if let Some(delta) = delta {
        if let Some(content) = non_empty_str(delta.get("content")) {
            events.push(ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Content,
                text: content.into(),
            });
        }
        if let Some(reasoning) = non_empty_str(delta.get("reasoning_content")) {
            events.push(ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Reasoning,
                text: reasoning.into(),
            });
        }
        if let Some(reasoning) = non_empty_str(delta.get("reasoning")) {
            events.push(ProviderStreamEvent::Token {
                kind: ProviderTokenKind::Reasoning,
                text: reasoning.into(),
            });
        }
        if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
            for tool_call in tool_calls {
                let function = tool_call.get("function");
                events.push(ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                    index: tool_call.get("index").and_then(Value::as_u64).unwrap_or(0),
                    id: non_empty_str(tool_call.get("id")).map(str::to_string),
                    name: function
                        .and_then(|function| non_empty_str(function.get("name")))
                        .map(str::to_string),
                    arguments: function
                        .and_then(|function| non_empty_str(function.get("arguments")))
                        .map(str::to_string),
                }));
            }
        }
    }

    if let Some(usage) = chunk.get("usage") {
        events.push(ProviderStreamEvent::Usage {
            input: usage
                .get("prompt_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cached_input: usage
                .get("prompt_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output: usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            reasoning_output: 0,
        });
    }

    events
}

fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
