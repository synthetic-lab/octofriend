use octofwen_llm::prompts::{BrokenDiffEdit, DiffEdit, fix_edit_prompt, fix_json_prompt};
use octofwen_protocol::json_rpc::{JsonRpcId, create_json_rpc_error, create_json_rpc_success};
use reqwest::blocking::Client;
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::{Value, json};

use super::INVALID_PARAMS;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutofixJsonParams {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: String,
    #[serde(rename = "brokenJson")]
    broken_json: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutofixEditParams {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: String,
    file: String,
    edit: AutofixEditParam,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutofixEditParam {
    search: String,
    replace: String,
}

pub(super) fn autofix_json_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofwen_protocol::json_rpc::JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<AutofixJsonParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let prompt = fix_json_prompt(&params.broken_json);
    let Some(completion) =
        execute_autofix_completion(&params.base_url, &params.api_key, &params.model, prompt)
    else {
        return create_json_rpc_success(id, json!({ "success": false }));
    };
    let Ok(value) = serde_json::from_str::<Value>(&completion.content) else {
        return create_json_rpc_success(id, json!({ "success": false, "usage": completion.usage }));
    };

    if value
        .get("success")
        .and_then(Value::as_bool)
        .is_some_and(|success| success)
    {
        create_json_rpc_success(
            id,
            json!({
                "success": true,
                "fixed": value.get("fixed").cloned().unwrap_or(Value::Null),
                "usage": completion.usage,
            }),
        )
    } else {
        create_json_rpc_success(id, json!({ "success": false, "usage": completion.usage }))
    }
}

pub(super) fn autofix_edit_response(
    id: JsonRpcId,
    params: Option<Value>,
) -> octofwen_protocol::json_rpc::JsonRpcResponse {
    let Some(params) = params else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };
    let Ok(params) = serde_json::from_value::<AutofixEditParams>(params) else {
        return create_json_rpc_error(id, INVALID_PARAMS, "Invalid params", None);
    };

    let prompt = fix_edit_prompt(&BrokenDiffEdit {
        file: params.file,
        edit: DiffEdit {
            search: params.edit.search,
            replace: params.edit.replace,
        },
    });
    let Some(completion) =
        execute_autofix_completion(&params.base_url, &params.api_key, &params.model, prompt)
    else {
        return create_json_rpc_success(id, json!({ "success": false }));
    };
    let Ok(value) = serde_json::from_str::<Value>(&completion.content) else {
        return create_json_rpc_success(id, json!({ "success": false, "usage": completion.usage }));
    };

    if value
        .get("success")
        .and_then(Value::as_bool)
        .is_some_and(|success| success)
    {
        if let Some(search) = value.get("search").and_then(Value::as_str) {
            return create_json_rpc_success(
                id,
                json!({
                    "success": true,
                    "search": search,
                    "usage": completion.usage,
                }),
            );
        }
    }

    create_json_rpc_success(id, json!({ "success": false, "usage": completion.usage }))
}

struct AutofixCompletion {
    content: String,
    usage: Value,
}

fn execute_autofix_completion(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: String,
) -> Option<AutofixCompletion> {
    let body = serde_json::to_string(&json!({
        "model": model,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": prompt,
        }],
        "response_format": {
            "type": "json_object",
        },
    }))
    .ok()?;
    let response = Client::new()
        .post(format!(
            "{}/chat/completions",
            base_url.trim_end_matches('/')
        ))
        .headers(autofix_headers(api_key)?)
        .body(body)
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let response_text = response.text().ok()?;
    let value = serde_json::from_str::<Value>(&response_text).ok()?;
    let content = value
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?
        .as_str()?
        .to_owned();
    let usage = json!({
        "input": value
            .get("usage")
            .and_then(|usage| usage.get("prompt_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        "output": value
            .get("usage")
            .and_then(|usage| usage.get("completion_tokens"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
    });
    Some(AutofixCompletion { content, usage })
}

fn autofix_headers(api_key: &str) -> Option<HeaderMap> {
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {api_key}")).ok()?,
    );
    Some(headers)
}
