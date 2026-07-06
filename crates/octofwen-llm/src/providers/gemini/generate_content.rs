use crate::providers::{
    ProviderHttpRequest,
    stream::{GeminiThoughtSignature, ProviderStreamEvent, ProviderTokenKind, ProviderToolDelta},
};
use serde_json::{Map, Value};

#[derive(Clone, Debug, PartialEq)]
pub struct GeminiGenerateContentCurlRequest {
    pub base_url: String,
    pub model: String,
    pub contents: Value,
    pub system_instruction: Option<Value>,
    pub tools: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GeminiGenerateContentHttpRequestParams {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub contents: Value,
    pub system_instruction: Option<Value>,
    pub tools: Option<Value>,
}

pub fn gemini_generate_content_curl(request: &GeminiGenerateContentCurlRequest) -> String {
    let body = gemini_generate_content_body(
        &request.contents,
        request.system_instruction.as_ref(),
        request.tools.as_ref(),
    );
    format!(
        "curl -X POST '{}' \\\n  -H \"Content-Type: application/json\" \\\n  -H \"x-goog-api-key: [REDACTED_API_KEY]\" \\\n  -d @- <<'JSON'\n{}\nJSON",
        gemini_generate_content_url(&request.base_url, &request.model),
        serde_json::to_string(&body).expect("serializing serde_json::Value cannot fail")
    )
}

pub fn gemini_generate_content_http_request(
    request: &GeminiGenerateContentHttpRequestParams,
) -> ProviderHttpRequest {
    ProviderHttpRequest {
        method: "POST".into(),
        url: gemini_generate_content_url(&request.base_url, &request.model),
        headers: vec![
            ("Content-Type".into(), "application/json".into()),
            ("x-goog-api-key".into(), request.api_key.clone()),
        ],
        body: gemini_generate_content_body(
            &request.contents,
            request.system_instruction.as_ref(),
            request.tools.as_ref(),
        ),
    }
}

fn gemini_generate_content_url(base_url: &str, model: &str) -> String {
    format!(
        "{}/models/{}:streamGenerateContent?alt=sse",
        base_url.trim_end_matches('/'),
        model
    )
}

fn gemini_generate_content_body(
    contents: &Value,
    system_instruction: Option<&Value>,
    tools: Option<&Value>,
) -> Value {
    let mut body = Map::new();
    body.insert("contents".into(), contents.clone());
    if let Some(system_instruction) = system_instruction {
        body.insert("systemInstruction".into(), system_instruction.clone());
    }
    if let Some(tools) = tools {
        body.insert("tools".into(), tools.clone());
    }
    Value::Object(body)
}

pub fn gemini_generate_content_stream_events(chunk: &Value) -> Vec<ProviderStreamEvent> {
    let mut events = Vec::new();
    let mut tool_index = 0_u64;
    if let Some(candidates) = chunk.get("candidates").and_then(Value::as_array) {
        for candidate in candidates {
            let Some(parts) = candidate
                .get("content")
                .and_then(|content| content.get("parts"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            for (part_index, part) in parts.iter().enumerate() {
                if let Some(text) = non_empty_str(part.get("text")) {
                    events.push(ProviderStreamEvent::Token {
                        kind: ProviderTokenKind::Content,
                        text: text.into(),
                    });
                }
                let mut tool_call_id = None;
                if let Some(function_call) = part.get("functionCall") {
                    let args = function_call
                        .get("args")
                        .map(json_value_string)
                        .unwrap_or_else(empty_json_object_string);
                    tool_call_id = non_empty_str(function_call.get("id")).map(str::to_string);
                    events.push(ProviderStreamEvent::Token {
                        kind: ProviderTokenKind::Tool,
                        text: args.clone(),
                    });
                    events.push(ProviderStreamEvent::ToolDelta(ProviderToolDelta {
                        index: tool_index,
                        id: tool_call_id.clone(),
                        name: non_empty_str(function_call.get("name")).map(str::to_string),
                        arguments: Some(args),
                    }));
                    tool_index += 1;
                }
                if let Some(thought_signature) = non_empty_str(part.get("thoughtSignature")) {
                    events.push(ProviderStreamEvent::GeminiThoughtSignature(
                        GeminiThoughtSignature {
                            part_index: part_index as u64,
                            tool_call_id,
                            thought_signature: thought_signature.into(),
                        },
                    ));
                }
            }
        }
    }

    if let Some(usage) = chunk.get("usageMetadata") {
        events.push(ProviderStreamEvent::Usage {
            input: usage
                .get("promptTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cached_input: usage
                .get("cachedContentTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output: usage
                .get("candidatesTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
            reasoning_output: usage
                .get("thoughtsTokenCount")
                .and_then(Value::as_u64)
                .unwrap_or(0),
        });
    }

    events
}

fn json_value_string(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| Value::Null.to_string())
}

fn empty_json_object_string() -> String {
    "{}".into()
}

fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}
