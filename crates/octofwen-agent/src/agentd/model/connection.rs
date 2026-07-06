use octofwen_protocol::json_rpc::{JsonRpcId, create_json_rpc_error, create_json_rpc_success};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

const INVALID_PARAMS: i64 = -32602;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelConnectionTestParams {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: String,
}

pub(in crate::agentd) fn model_connection_test_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofwen_protocol::json_rpc::JsonRpcResponse {
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
    let chat = client
        .post(join_openai_path(&params.base_url, "/chat/completions"))
        .headers(openai_headers(&params.api_key))
        .body(
            json!({
            "model": params.model,
            "messages": [{
                "role": "user",
                "content": "Respond with the word 'hi' and only the word 'hi'",
            }],
            })
            .to_string(),
        )
        .send()
        .map_err(|error| error.to_string())?;
    if !chat.status().is_success() {
        return Err(chat.text().unwrap_or_else(|error| error.to_string()));
    }
    let chat_json: Value = serde_json::from_str(&chat.text().map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let metadata = model_metadata(&client, params).unwrap_or_else(|| json!({}));
    Ok(json!({
        "valid": true,
        "promptTokens": chat_json.pointer("/usage/prompt_tokens").and_then(Value::as_u64),
        "completionTokens": chat_json.pointer("/usage/completion_tokens").and_then(Value::as_u64),
        "metadata": metadata,
    }))
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
