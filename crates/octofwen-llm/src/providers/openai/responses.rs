use crate::providers::{
    ProviderHttpRequest,
    openai::curl::{openai_endpoint_url, redacted_openai_curl},
    stream::{
        ProviderOpenAiResponsesMetadata, ProviderStreamEvent, ProviderTokenKind, ProviderToolDelta,
    },
    value::non_empty_str,
};
type StreamEvents = Vec<ProviderStreamEvent>;

use serde_json::{Map, Value};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenAiResponsesCurlRequest {
    pub base_url: String,
    pub model: String,
    pub input: Value,
    pub instructions: Option<String>,
    pub tools: Option<Value>,
    pub reasoning: Option<Value>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenAiResponsesHttpRequestParams {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub input: Value,
    pub instructions: Option<String>,
    pub tools: Option<Value>,
    pub reasoning: Option<Value>,
}

pub fn openai_responses_curl(request: &OpenAiResponsesCurlRequest) -> String {
    redacted_openai_curl(
        &request.base_url,
        "responses",
        &openai_responses_body(
            &request.model,
            &request.input,
            request.instructions.as_deref(),
            request.tools.as_ref(),
            request.reasoning.as_ref(),
        ),
    )
}

pub fn openai_responses_http_request(
    request: &OpenAiResponsesHttpRequestParams,
) -> ProviderHttpRequest {
    ProviderHttpRequest {
        method: "POST".into(),
        url: openai_endpoint_url(&request.base_url, "responses"),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            (
                "Authorization".into(),
                format!("Bearer {}", request.api_key),
            ),
        ],
        body: openai_responses_body(
            &request.model,
            &request.input,
            request.instructions.as_deref(),
            request.tools.as_ref(),
            request.reasoning.as_ref(),
        ),
    }
}

fn openai_responses_body(
    model: &str,
    input: &Value,
    instructions: Option<&str>,
    tools: Option<&Value>,
    reasoning: Option<&Value>,
) -> Value {
    let mut body = Map::new();
    body.insert(
        "include".into(),
        Value::Array(vec![Value::String("reasoning.encrypted_content".into())]),
    );
    body.insert("input".into(), input.clone());
    if let Some(instructions) = instructions {
        body.insert("instructions".into(), Value::String(instructions.into()));
    }
    body.insert("model".into(), Value::String(model.into()));
    if let Some(reasoning) = reasoning {
        body.insert("reasoning".into(), reasoning.clone());
    }
    body.insert("store".into(), Value::Bool(false));
    body.insert("stream".into(), Value::Bool(true));
    if let Some(tools) = tools {
        body.insert("tools".into(), tools.clone());
    }
    Value::Object(body)
}

pub fn openai_responses_stream_events(event: &Value) -> StreamEvents {
    match event.get("type").and_then(Value::as_str) {
        Some("response.output_text.delta") => {
            token_event(event, "delta", ProviderTokenKind::Content)
        }
        Some("response.reasoning_text.delta") | Some("response.reasoning_summary_text.delta") => {
            token_event(event, "delta", ProviderTokenKind::Reasoning)
        }
        Some("response.function_call_arguments.delta") => {
            token_event(event, "delta", ProviderTokenKind::Tool)
        }
        Some("response.output_item.done") => event
            .get("item")
            .map(response_output_item_events)
            .unwrap_or_default(),
        Some("response.completed") => response_completed_events(event),
        _ => Vec::new(),
    }
}

fn response_completed_events(event: &Value) -> StreamEvents {
    let mut events = Vec::new();
    if let Some(output) = event
        .get("response")
        .and_then(|response| response.get("output"))
        .and_then(Value::as_array)
    {
        for item in output {
            events.extend(response_output_item_events(item));
        }
    }
    if let Some(usage) = event
        .get("response")
        .and_then(|response| response.get("usage"))
    {
        events.push(ProviderStreamEvent::Usage {
            input: usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cached_input: usage
                .get("input_tokens_details")
                .and_then(|details| details.get("cached_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output: usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            reasoning_output: usage
                .get("output_tokens_details")
                .and_then(|details| details.get("reasoning_tokens"))
                .and_then(Value::as_u64)
                .unwrap_or(0),
        });
    }
    events
}

fn response_output_item_events(item: &Value) -> StreamEvents {
    match item.get("type").and_then(Value::as_str) {
        Some("function_call") => vec![ProviderStreamEvent::ToolDelta(ProviderToolDelta {
            index: 0,
            id: non_empty_str(item.get("call_id")).map(str::to_string),
            name: non_empty_str(item.get("name")).map(str::to_string),
            arguments: non_empty_str(item.get("arguments")).map(str::to_string),
        })],
        Some("reasoning") => vec![ProviderStreamEvent::OpenAiResponsesMetadata(
            ProviderOpenAiResponsesMetadata {
                reasoning_id: non_empty_str(item.get("id")).map(str::to_string),
                encrypted_reasoning_content: non_empty_str(item.get("encrypted_content"))
                    .map(str::to_string),
                reasoning_text: reasoning_text_from_item(item),
            },
        )],
        _ => Vec::new(),
    }
}

fn reasoning_text_from_item(item: &Value) -> Option<String> {
    let mut parts = Vec::new();
    push_reasoning_text_parts(&mut parts, item.get("content"));
    push_reasoning_text_parts(&mut parts, item.get("summary"));
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n"))
    }
}

fn push_reasoning_text_parts(parts: &mut Vec<String>, value: Option<&Value>) {
    let Some(items) = value.and_then(Value::as_array) else {
        return;
    };
    for item in items {
        if let Some(text) = non_empty_str(item.get("text")) {
            parts.push(text.into());
        }
    }
}

fn token_event(value: &Value, field: &str, kind: ProviderTokenKind) -> StreamEvents {
    non_empty_str(value.get(field))
        .map(|text| {
            vec![ProviderStreamEvent::Token {
                kind,
                text: text.into(),
            }]
        })
        .unwrap_or_default()
}
