use octofwen_models::providers::{
    ProviderHttpRequest,
    anthropic::{AnthropicMessagesHttpRequestParams, anthropic_messages_http_request},
    gemini::{GeminiGenerateContentHttpRequestParams, gemini_generate_content_http_request},
    openai::{
        OpenAiChatCompletionsHttpRequestParams, OpenAiResponsesHttpRequestParams,
        openai_chat_completions_http_request, openai_responses_http_request,
    },
};
use octofwen_wire::json_rpc::{JsonRpcId, create_json_rpc_error, create_json_rpc_success};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

use super::super::event_stream::parse_server_sent_json_events;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConnectionTestParams {
    #[serde(rename = "type")]
    provider_type: Option<ModelConnectionProviderType>,
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
enum ModelConnectionProviderType {
    Standard,
    OpenaiResponses,
    Anthropic,
    Gemini,
}

pub(in crate::runtime) fn model_connection_test_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofwen_wire::json_rpc::JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ModelConnectionTestParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    match run_model_connection_test(&params) {
        Ok(result) => create_json_rpc_success(id, result),
        Err(message) => create_json_rpc_error(id, -32010, &message, None),
    }
}

fn run_model_connection_test(params: &ModelConnectionTestParams) -> Result<Value, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    match params
        .provider_type
        .unwrap_or(ModelConnectionProviderType::Standard)
    {
        ModelConnectionProviderType::Standard => {
            run_openai_chat_model_connection_test(&client, params)
        }
        ModelConnectionProviderType::OpenaiResponses => {
            run_openai_responses_model_connection_test(&client, params)
        }
        ModelConnectionProviderType::Anthropic => {
            run_anthropic_model_connection_test(&client, params)
        }
        ModelConnectionProviderType::Gemini => run_gemini_model_connection_test(&client, params),
    }
}

fn run_openai_chat_model_connection_test(
    client: &reqwest::blocking::Client,
    params: &ModelConnectionTestParams,
) -> Result<Value, String> {
    let request = openai_chat_completions_http_request(&OpenAiChatCompletionsHttpRequestParams {
        base_url: params.base_url.clone(),
        api_key: params.api_key.clone(),
        model: params.model.clone(),
        messages: connection_openai_messages(),
        tools: None,
    });
    let chat_json = provider_request_json(client, &request)?;
    let metadata = model_metadata(client, params).unwrap_or_else(|| json!({}));
    Ok(json!({
        "valid": true,
        "promptTokens": chat_json.pointer("/usage/prompt_tokens").and_then(Value::as_u64),
        "completionTokens": chat_json.pointer("/usage/completion_tokens").and_then(Value::as_u64),
        "metadata": metadata,
    }))
}

fn run_openai_responses_model_connection_test(
    client: &reqwest::blocking::Client,
    params: &ModelConnectionTestParams,
) -> Result<Value, String> {
    let request = openai_responses_http_request(&OpenAiResponsesHttpRequestParams {
        base_url: params.base_url.clone(),
        api_key: params.api_key.clone(),
        model: params.model.clone(),
        input: connection_openai_responses_input(),
        instructions: None,
        tools: None,
        reasoning: None,
    });
    let response_json = provider_request_json(client, &request)?;
    Ok(json!({
        "valid": true,
        "promptTokens": response_json
            .pointer("/usage/input_tokens")
            .or_else(|| response_json.pointer("/response/usage/input_tokens"))
            .and_then(Value::as_u64),
        "completionTokens": response_json
            .pointer("/usage/output_tokens")
            .or_else(|| response_json.pointer("/response/usage/output_tokens"))
            .and_then(Value::as_u64),
        "metadata": {},
    }))
}

fn run_anthropic_model_connection_test(
    client: &reqwest::blocking::Client,
    params: &ModelConnectionTestParams,
) -> Result<Value, String> {
    let request = anthropic_messages_http_request(&AnthropicMessagesHttpRequestParams {
        base_url: params.base_url.clone(),
        api_key: params.api_key.clone(),
        model: params.model.clone(),
        system: String::new(),
        messages: connection_anthropic_messages(),
        tools: None,
        max_tokens: 16,
        thinking: None,
        output_config: None,
    });
    let response_json = provider_request_json(client, &request)?;
    Ok(json!({
        "valid": true,
        "promptTokens": response_json
            .pointer("/usage/input_tokens")
            .or_else(|| response_json.pointer("/message/usage/input_tokens"))
            .and_then(Value::as_u64),
        "completionTokens": response_json
            .pointer("/usage/output_tokens")
            .or_else(|| response_json.pointer("/message/usage/output_tokens"))
            .and_then(Value::as_u64),
        "metadata": {},
    }))
}

fn provider_request_json(
    client: &reqwest::blocking::Client,
    request: &ProviderHttpRequest,
) -> Result<Value, String> {
    let response_text = send_provider_request(client, request)?;
    provider_response_json(&response_text)
}

fn send_provider_request(
    client: &reqwest::blocking::Client,
    request: &ProviderHttpRequest,
) -> Result<String, String> {
    let chat = client
        .post(&request.url)
        .headers(provider_headers(request)?)
        .body(request.body.to_string())
        .send()
        .map_err(|error| error.to_string())?;
    if !chat.status().is_success() {
        return Err(chat.text().unwrap_or_else(|error| error.to_string()));
    }
    chat.text().map_err(|error| error.to_string())
}

fn provider_response_json(response_text: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str::<Value>(response_text) {
        return Ok(value);
    }

    parse_server_sent_json_events(response_text, "connection")?
        .into_iter()
        .last()
        .ok_or_else(|| "Connection test returned no stream events".into())
}

fn run_gemini_model_connection_test(
    client: &reqwest::blocking::Client,
    params: &ModelConnectionTestParams,
) -> Result<Value, String> {
    let request = gemini_generate_content_http_request(&GeminiGenerateContentHttpRequestParams {
        base_url: params.base_url.clone(),
        api_key: params.api_key.clone(),
        model: params.model.clone(),
        contents: json!([{
            "parts": [{
                "text": "Respond with the word 'hi' and only the word 'hi'",
            }],
            "role": "user",
        }]),
        system_instruction: None,
        tools: None,
        generation_config: None,
    });
    let response = client
        .post(&request.url)
        .headers(provider_headers(&request)?)
        .body(request.body.to_string())
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(response.text().unwrap_or_else(|error| error.to_string()));
    }
    let response_text = response.text().map_err(|error| error.to_string())?;
    let response_json = provider_response_json(&response_text)?;
    Ok(json!({
        "valid": true,
        "promptTokens": response_json.pointer("/usageMetadata/promptTokenCount").and_then(Value::as_u64),
        "completionTokens": response_json.pointer("/usageMetadata/candidatesTokenCount").and_then(Value::as_u64),
        "metadata": {},
    }))
}

fn provider_headers(request: &ProviderHttpRequest) -> Result<reqwest::header::HeaderMap, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    for (name, value) in &request.headers {
        let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| error.to_string())?;
        let header_value =
            reqwest::header::HeaderValue::from_str(value).map_err(|error| error.to_string())?;
        headers.insert(header_name, header_value);
    }
    if !headers.contains_key(reqwest::header::USER_AGENT) {
        headers.insert(
            reqwest::header::USER_AGENT,
            reqwest::header::HeaderValue::from_static(concat!(
                "octofriend/",
                env!("CARGO_PKG_VERSION")
            )),
        );
    }
    Ok(headers)
}

fn model_metadata(
    client: &reqwest::blocking::Client,
    params: &ModelConnectionTestParams,
) -> Option<Value> {
    let models = client
        .get(join_openai_path(&params.base_url, "/models"))
        .headers(openai_headers(&params.api_key))
        .timeout(Duration::from_secs(3))
        .send()
        .ok()?;
    if !models.status().is_success() {
        return None;
    }
    let models_json: Value = serde_json::from_str(&models.text().ok()?).ok()?;
    let model = models_json
        .get("data")?
        .as_array()?
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(params.model.as_str()))?;
    let mut metadata = serde_json::Map::new();
    if let Some(name) = model.get("name").and_then(Value::as_str) {
        metadata.insert("name".into(), Value::String(name.into()));
    }
    if let Some(context_length) = model.get("context_length").and_then(Value::as_u64) {
        metadata.insert("contextLength".into(), Value::from(context_length));
    }
    Some(Value::Object(metadata))
}

fn openai_headers(api_key: &str) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );
    if let Ok(value) = reqwest::header::HeaderValue::from_str(&format!("Bearer {api_key}")) {
        headers.insert(reqwest::header::AUTHORIZATION, value);
    }
    headers.insert(
        reqwest::header::USER_AGENT,
        reqwest::header::HeaderValue::from_static(concat!(
            "octofriend/",
            env!("CARGO_PKG_VERSION")
        )),
    );
    headers
}

fn join_openai_path(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn connection_prompt() -> &'static str {
    "Respond with the word 'hi' and only the word 'hi'"
}

fn connection_openai_messages() -> Value {
    json!([{
        "role": "user",
        "content": connection_prompt(),
    }])
}

fn connection_openai_responses_input() -> Value {
    json!([{
        "role": "user",
        "content": [{
            "type": "input_text",
            "text": connection_prompt(),
        }],
    }])
}

fn connection_anthropic_messages() -> Value {
    json!([{
        "role": "user",
        "content": [{
            "type": "text",
            "text": connection_prompt(),
        }],
    }])
}
