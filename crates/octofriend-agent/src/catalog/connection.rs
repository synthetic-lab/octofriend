use octofriend_models::providers::{
    ProviderHttpRequest,
    anthropic::{AnthropicMessagesHttpRequestParams, anthropic_messages_http_request},
    gemini::{GeminiGenerateContentHttpRequestParams, gemini_generate_content_http_request},
    openai::{
        OpenAiChatCompletionsHttpRequestParams, OpenAiResponsesHttpRequestParams,
        openai_chat_completions_http_request, openai_responses_http_request,
    },
};
use octofriend_wire::json_rpc::{JsonRpcId, create_json_rpc_error, create_json_rpc_success};
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelDiscoverParams {
    #[serde(rename = "type")]
    provider_type: Option<ModelConnectionProviderType>,
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
}

pub(in crate::runtime) fn model_discover_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofriend_wire::json_rpc::JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<ModelDiscoverParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(client) => client,
        Err(error) => return create_json_rpc_error(id, -32010, &error.to_string(), None),
    };
    let is_gemini = params.provider_type == Some(ModelConnectionProviderType::Gemini);
    let url = if is_gemini {
        format!(
            "{}?key={}",
            join_openai_path(&params.base_url, "/models"),
            params.api_key
        )
    } else {
        join_openai_path(&params.base_url, "/models")
    };
    let response = client
        .get(url)
        .headers(if is_gemini {
            reqwest::header::HeaderMap::new()
        } else {
            openai_headers(&params.api_key)
        })
        .send();
    let result = response
        .and_then(reqwest::blocking::Response::error_for_status)
        .and_then(reqwest::blocking::Response::text)
        .map_err(|error| error.to_string())
        .and_then(|text| serde_json::from_str::<Value>(&text).map_err(|error| error.to_string()));
    match result {
        Ok(value) => {
            let entries = value
                .get("data")
                .or_else(|| value.get("models"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let models = entries
                .into_iter()
                .filter_map(|entry| {
                    let id = entry
                        .get("id")
                        .or_else(|| entry.get("name"))
                        .and_then(Value::as_str)?;
                    let name = entry
                        .get("name")
                        .or_else(|| entry.get("displayName"))
                        .and_then(Value::as_str);
                    let context = entry
                        .get("context_length")
                        .or_else(|| entry.get("inputTokenLimit"))
                        .and_then(Value::as_u64);
                    let mut model = serde_json::Map::new();
                    model.insert("id".into(), json!(id));
                    if let Some(name) = name {
                        model.insert("name".into(), json!(name));
                    }
                    if let Some(context) = context {
                        model.insert("context_length".into(), json!(context));
                    }
                    Some(Value::Object(model))
                })
                .collect::<Vec<_>>();
            create_json_rpc_success(id, json!({ "models": models }))
        }
        Err(error) => create_json_rpc_error(id, -32010, error, None),
    }
}

pub(in crate::runtime) fn model_connection_test_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofriend_wire::json_rpc::JsonRpcResponse {
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
    let model_entries = models_json.get("data")?.as_array()?;
    let model = model_entries
        .iter()
        .find(|entry| entry.get("id").and_then(Value::as_str) == Some(params.model.as_str()))?;
    let mut metadata = serde_json::Map::new();
    if let Some(name) = model.get("name").and_then(Value::as_str) {
        metadata.insert("name".into(), Value::String(name.into()));
    }
    if let Some(context_length) = model.get("context_length").and_then(Value::as_u64) {
        metadata.insert("contextLength".into(), Value::from(context_length));
    }
    let discovered_models = model_entries
        .iter()
        .filter_map(|entry| {
            let model = entry.get("id")?.as_str()?;
            let mut discovered = serde_json::Map::new();
            discovered.insert("model".into(), Value::String(model.into()));
            discovered.insert(
                "nickname".into(),
                Value::String(
                    entry
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or(model)
                        .into(),
                ),
            );
            if let Some(context) = entry.get("context_length").and_then(Value::as_u64) {
                discovered.insert("context".into(), Value::from(context));
            }
            Some(Value::Object(discovered))
        })
        .collect::<Vec<_>>();
    metadata.insert("models".into(), Value::Array(discovered_models));
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
