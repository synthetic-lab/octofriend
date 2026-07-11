use octofriend_models::compiler::{
    AssistantOutputProvider, AssistantOutputRequest, build_assistant_output,
};
use octofriend_models::providers::anthropic::anthropic_messages_stream_events;
use octofriend_models::providers::gemini::gemini_generate_content_stream_events;
use octofriend_models::providers::openai::{
    openai_chat_completions_stream_events, openai_responses_stream_events,
};
use octofriend_models::providers::stream::{
    ProviderStreamEvent, ProviderStreamState, apply_provider_stream_events,
};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::super::event_stream::parse_server_sent_json_events;
use super::stream::{provider_stream_events_json, provider_stream_state_json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::runtime) struct ProviderHttpStreamRequest {
    pub(in crate::runtime) method: String,
    pub(in crate::runtime) url: String,
    pub(in crate::runtime) headers: Map<String, Value>,
    pub(in crate::runtime) body: Value,
}

pub(in crate::runtime) fn provider_http_events_result_json(
    provider: &str,
    assistant_output_provider: AssistantOutputProvider,
    tools_enabled: bool,
    request: ProviderHttpStreamRequest,
) -> Result<Value, ProviderHttpStreamError> {
    let result = execute_provider_http_stream(request)?;
    let events = result
        .events
        .iter()
        .flat_map(|event| match provider {
            "openai-chat-completions" => openai_chat_completions_stream_events(event),
            "openai-responses" => openai_responses_stream_events(event),
            "anthropic" => anthropic_messages_stream_events(event),
            "gemini" => gemini_generate_content_stream_events(event),
            _ => Vec::new(),
        })
        .collect::<Vec<_>>();
    let mut state = ProviderStreamState::default();
    apply_provider_stream_events(&mut state, &events);
    let assistant_output = build_assistant_output(&AssistantOutputRequest {
        provider: assistant_output_provider,
        state: state.clone(),
    });

    Ok(json!({
        "provider": provider,
        "events": provider_stream_events_json(&events),
        "state": provider_stream_state_json(&state),
        "unexpectedToolCall": unexpected_tool_call(&events, tools_enabled),
        "output": assistant_output.output,
        "usage": assistant_output.usage,
        "headers": result.headers,
    }))
}

struct ProviderHttpStreamResult {
    events: Vec<Value>,
    headers: Map<String, Value>,
}

#[derive(Debug)]
pub(in crate::runtime) struct ProviderHttpStreamError {
    pub(in crate::runtime) message: String,
    pub(in crate::runtime) headers: Map<String, Value>,
    pub(in crate::runtime) status_code: Option<u16>,
}

impl ProviderHttpStreamError {
    fn without_headers(message: String) -> Self {
        Self {
            message,
            headers: Map::new(),
            status_code: None,
        }
    }
}

fn execute_provider_http_stream(
    request: ProviderHttpStreamRequest,
) -> Result<ProviderHttpStreamResult, ProviderHttpStreamError> {
    let headers =
        request_headers(&request.headers).map_err(ProviderHttpStreamError::without_headers)?;
    let body = serde_json::to_string(&request.body).map_err(|error| {
        ProviderHttpStreamError::without_headers(format!(
            "Failed to serialize provider request body: {error}"
        ))
    })?;
    let method = request.method.parse().map_err(|error| {
        ProviderHttpStreamError::without_headers(format!("Invalid provider HTTP method: {error}"))
    })?;
    let response = Client::new()
        .request(method, request.url)
        .headers(headers)
        .body(body)
        .send()
        .map_err(|error| {
            ProviderHttpStreamError::without_headers(format!(
                "Provider HTTP request failed: {error}"
            ))
        })?;
    let status = response.status();
    let response_headers = response_headers(response.headers());
    let response_text = response.text().map_err(|error| ProviderHttpStreamError {
        message: format!("Provider HTTP response read failed: {error}"),
        headers: response_headers.clone(),
        status_code: Some(status.as_u16()),
    })?;
    if !status.is_success() {
        let message = if response_text.is_empty() {
            status.to_string()
        } else {
            response_text
        };
        return Err(ProviderHttpStreamError {
            message,
            headers: response_headers,
            status_code: Some(status.as_u16()),
        });
    }

    let events = parse_server_sent_json_events(&response_text, "provider").map_err(|error| {
        ProviderHttpStreamError {
            message: error,
            headers: response_headers.clone(),
            status_code: Some(status.as_u16()),
        }
    })?;

    Ok(ProviderHttpStreamResult {
        events,
        headers: response_headers,
    })
}

fn request_headers(headers: &Map<String, Value>) -> Result<HeaderMap, String> {
    let mut output = HeaderMap::new();
    for (name, value) in headers {
        let Some(value) = value.as_str() else {
            return Err(format!("Invalid provider HTTP header value for {name}"));
        };
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid provider HTTP header name: {error}"))?;
        let value = HeaderValue::from_str(value)
            .map_err(|error| format!("Invalid provider HTTP header value: {error}"))?;
        output.insert(name, value);
    }
    Ok(output)
}

fn response_headers(headers: &HeaderMap) -> Map<String, Value> {
    let mut output = Map::new();
    for (name, value) in headers {
        if let Ok(value) = value.to_str() {
            output.insert(name.as_str().to_owned(), Value::String(value.to_owned()));
        }
    }
    output
}

fn unexpected_tool_call(events: &[ProviderStreamEvent], tools_enabled: bool) -> bool {
    !tools_enabled
        && events.iter().any(|event| {
            matches!(
                event,
                ProviderStreamEvent::Token {
                    kind: octofriend_models::providers::stream::ProviderTokenKind::Tool,
                    ..
                } | ProviderStreamEvent::ToolDelta(_)
            )
        })
}
